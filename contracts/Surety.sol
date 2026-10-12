// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

contract Surety {
    enum Status { Posted, Released, SlopPending, Forfeited, Reclaimed }
    struct Bond {
        address contributor;
        address project;
        uint256 amount;
        uint64 expiry;
        uint64 slopUnlockAt;
        bytes32 reasonHash;
        Status status;
    }

    IERC20 public immutable token;
    address public immutable triageFund;
    uint64 public immutable slopTimelock;
    mapping(bytes32 => Bond) public bonds;
    uint256 private _entered = 1;

    modifier nonReentrant() {
        require(_entered == 1, "reentrant");
        _entered = 2;
        _;
        _entered = 1;
    }

    event BondPosted(bytes32 indexed id, address indexed contributor, address indexed project, uint256 amount, uint64 expiry);
    event BondReleased(bytes32 indexed id, address indexed contributor, uint256 amount);
    event SlopFlagged(bytes32 indexed id, bytes32 indexed reasonHash, uint64 unlockAt);
    event BondForfeited(bytes32 indexed id, address indexed triageFund, uint256 amount);
    event BondReclaimed(bytes32 indexed id, address indexed contributor, uint256 amount);

    constructor(address token_, address triageFund_, uint64 slopTimelock_) {
        require(token_ != address(0) && triageFund_ != address(0), "invalid address");
        token = IERC20(token_);
        triageFund = triageFund_;
        slopTimelock = slopTimelock_;
    }

    function postBond(bytes32 id, address project, uint256 amount, uint64 expiry) external nonReentrant {
        require(bonds[id].contributor == address(0), "bond exists");
        require(project != address(0) && amount > 0 && expiry > block.timestamp, "invalid bond");
        bonds[id] = Bond(msg.sender, project, amount, expiry, 0, bytes32(0), Status.Posted);
        emit BondPosted(id, msg.sender, project, amount, expiry);
        require(token.transferFrom(msg.sender, address(this), amount), "transfer in failed");
    }

    function release(bytes32 id) external nonReentrant {
        Bond storage bond = bonds[id];
        require(msg.sender == bond.project && bond.status == Status.Posted, "not releasable");
        bond.status = Status.Released;
        emit BondReleased(id, bond.contributor, bond.amount);
        require(token.transfer(bond.contributor, bond.amount), "transfer out failed");
    }

    function flagSlop(bytes32 id, bytes32 reasonHash) external nonReentrant {
        Bond storage bond = bonds[id];
        require(msg.sender == bond.project && bond.status == Status.Posted, "not flaggable");
        require(reasonHash != bytes32(0), "reason required");
        require(block.timestamp <= type(uint64).max && uint256(slopTimelock) <= type(uint64).max - block.timestamp, "timestamp overflow");
        bond.status = Status.SlopPending;
        bond.reasonHash = reasonHash;
        bond.slopUnlockAt = uint64(block.timestamp) + slopTimelock;
        emit SlopFlagged(id, reasonHash, bond.slopUnlockAt);
    }

    function finalizeForfeit(bytes32 id) external nonReentrant {
        Bond storage bond = bonds[id];
        require(bond.status == Status.SlopPending && block.timestamp >= bond.slopUnlockAt, "forfeit locked");
        bond.status = Status.Forfeited;
        emit BondForfeited(id, triageFund, bond.amount);
        require(token.transfer(triageFund, bond.amount), "transfer out failed");
    }

    function reclaim(bytes32 id) external nonReentrant {
        Bond storage bond = bonds[id];
        require(bond.status == Status.Posted && block.timestamp >= bond.expiry, "not reclaimable");
        bond.status = Status.Reclaimed;
        emit BondReclaimed(id, bond.contributor, bond.amount);
        require(token.transfer(bond.contributor, bond.amount), "transfer out failed");
    }
}
