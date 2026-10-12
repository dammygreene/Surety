// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../Surety.sol";

interface Vm {
    function warp(uint256) external;
    function prank(address) external;
    function assume(bool) external;
    function expectRevert(bytes calldata) external;
    function expectEmit(bool, bool, bool, bool) external;
}

contract MockToken is IERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    bool public failTransfers;
    bool public reenter;
    Surety public target;
    bytes32 public reenterId;

    function mint(address to, uint256 amount) external { balanceOf[to] += amount; }
    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }
    function setFailTransfers(bool value) external { failTransfers = value; }
    function setReenter(Surety value, bytes32 id) external { target = value; reenterId = id; reenter = true; }
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (failTransfers || allowance[from][msg.sender] < amount || balanceOf[from] < amount) return false;
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
    function transfer(address to, uint256 amount) external returns (bool) {
        if (failTransfers || balanceOf[msg.sender] < amount) return false;
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        if (reenter) {
            reenter = false;
            target.reclaim(reenterId);
        }
        return true;
    }
}

contract SuretyTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    MockToken token;
    Surety surety;
    address contributor = address(0x100);
    address project = address(0x200);
    address triage = address(0x300);
    address stranger = address(0x400);
    uint256 constant AMOUNT = 2_000_000;

    function setUp() public {
        token = new MockToken();
        surety = new Surety(address(token), triage, 1 days);
        token.mint(contributor, AMOUNT * 4);
        vm.prank(contributor);
        token.approve(address(surety), type(uint256).max);
    }

    function post(bytes32 id, uint64 expiry) internal {
        vm.prank(contributor);
        surety.postBond(id, project, AMOUNT, expiry);
    }

    function testLifecycleValidRelease() public {
        bytes32 id = keccak256("valid");
        post(id, uint64(block.timestamp + 1 days));
        assert(token.balanceOf(address(surety)) == AMOUNT);
        vm.prank(project);
        surety.release(id);
        assert(token.balanceOf(contributor) == AMOUNT * 4);
        vm.prank(project);
        vm.expectRevert("not releasable");
        surety.release(id);
    }

    function testSlopTimelockAndTriageDestination() public {
        bytes32 id = keccak256("slop");
        post(id, uint64(block.timestamp + 1 days));
        vm.prank(project);
        surety.flagSlop(id, keccak256("reason"));
        vm.expectRevert("forfeit locked");
        surety.finalizeForfeit(id);
        vm.warp(block.timestamp + 1 days);
        surety.finalizeForfeit(id);
        assert(token.balanceOf(triage) == AMOUNT);
        vm.expectRevert("forfeit locked");
        surety.finalizeForfeit(id);
    }

    function testPermissionlessReclaimAtExpiryPaysContributor() public {
        bytes32 id = keccak256("reclaim");
        uint64 expiry = uint64(block.timestamp + 1 days);
        post(id, expiry);
        vm.expectRevert("not reclaimable");
        surety.reclaim(id);
        vm.warp(expiry);
        vm.prank(stranger);
        surety.reclaim(id);
        assert(token.balanceOf(contributor) == AMOUNT * 4);
        vm.expectRevert("not reclaimable");
        surety.reclaim(id);
    }

    function testDuplicateIdUnauthorizedAndInvalidInputs() public {
        bytes32 id = keccak256("duplicate");
        post(id, uint64(block.timestamp + 1 days));
        vm.prank(contributor);
        vm.expectRevert("bond exists");
        surety.postBond(id, project, AMOUNT, uint64(block.timestamp + 2 days));
        vm.prank(stranger);
        vm.expectRevert("not releasable");
        surety.release(id);
        vm.prank(project);
        vm.expectRevert("reason required");
        surety.flagSlop(id, bytes32(0));
        vm.prank(contributor);
        vm.expectRevert("invalid bond");
        surety.postBond(keccak256("zero"), project, 0, uint64(block.timestamp + 1 days));
    }

    function testTransferFailureRevertsAndLeavesPosted() public {
        bytes32 id = keccak256("failure");
        post(id, uint64(block.timestamp + 1 days));
        token.setFailTransfers(true);
        vm.prank(project);
        vm.expectRevert("transfer out failed");
        surety.release(id);
        (, , , , , , Surety.Status status) = surety.bonds(id);
        assert(status == Surety.Status.Posted);
    }

    function testReentrancyGuard() public {
        bytes32 id = keccak256("reentrancy");
        post(id, uint64(block.timestamp + 1 days));
        token.setReenter(surety, id);
        vm.prank(project);
        vm.expectRevert("reentrant");
        surety.release(id);
    }

    function testFuzzAmountsRefundExactly(uint256 amount) public {
        vm.assume(amount > 0 && amount <= AMOUNT * 4);
        bytes32 id = keccak256("fuzz-amount");
        vm.prank(contributor);
        surety.postBond(id, project, amount, uint64(block.timestamp + 1 days));
        vm.prank(project);
        surety.release(id);
        assert(token.balanceOf(contributor) == AMOUNT * 4);
    }

    function testFuzzUnauthorizedRelease(address caller) public {
        vm.assume(caller != project && caller != address(0));
        bytes32 id = keccak256("fuzz-unauthorized");
        post(id, uint64(block.timestamp + 1 days));
        vm.prank(caller);
        vm.expectRevert("not releasable");
        surety.release(id);
    }

    function testFuzzDeadlineBoundary(uint64 offset) public {
        vm.assume(offset > 0 && offset < 365 days);
        bytes32 id = keccak256("fuzz-deadline");
        uint64 expiry = uint64(block.timestamp) + offset;
        post(id, expiry);
        vm.warp(expiry - 1);
        vm.expectRevert("not reclaimable");
        surety.reclaim(id);
        vm.warp(expiry);
        surety.reclaim(id);
    }

    function testZeroProjectRejected() public {
        vm.prank(contributor);
        vm.expectRevert("invalid bond");
        surety.postBond(keccak256("zero-project"), address(0), AMOUNT, uint64(block.timestamp + 1 days));
    }

    function testReclaimTransferFailureLeavesBondPosted() public {
        bytes32 id = keccak256("reclaim-failure");
        uint64 expiry = uint64(block.timestamp + 1 days);
        post(id, expiry);
        token.setFailTransfers(true);
        vm.warp(expiry);
        vm.expectRevert("transfer out failed");
        surety.reclaim(id);
        (, , , , , , Surety.Status status) = surety.bonds(id);
        assert(status == Surety.Status.Posted);
    }
}
