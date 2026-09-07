const { ethers, expect, loadFixture, deploy } = require('./helpers/fixture');
async function recoveryFixture() {
  const f = await deploy(); f.token = await ethers.deployContract('MockERC20');
  await f.token.transfer(f.core.target, 1000); return f;
}
describe('Ownable recovery and SafeERC20', function () {
  it('should recover standard ERC20 to the specified recipient with exact event and balances', async function () {
    const { core, token, alice } = await loadFixture(recoveryFixture);
    await expect(core.emergencyWithdrawERC20(token.target, alice, 400)).emit(core, 'EmergencyWithdrawERC20').withArgs(token.target, alice.address, 400);
    expect(await token.balanceOf(core.target)).eq(600); expect(await token.balanceOf(alice)).eq(400);
  });
  it('should deny non-owner including ADMIN and move recovery power upon ownership transfer', async function () {
    const { core, token, owner, alice, admin } = await loadFixture(recoveryFixture); await core.grantAdminRole(admin);
    for (const caller of [alice, admin]) await expect(core.connect(caller).emergencyWithdrawERC20(token.target, alice, 1)).revertedWithCustomError(core, 'OwnableUnauthorizedAccount').withArgs(caller.address);
    await core.transferOwnership(alice);
    await expect(core.emergencyWithdrawERC20(token.target, owner, 1)).revertedWithCustomError(core, 'OwnableUnauthorizedAccount').withArgs(owner.address);
    await core.connect(alice).emergencyWithdrawERC20(token.target, alice, 100);
    expect(await token.balanceOf(alice)).eq(100); expect(await token.balanceOf(core.target)).eq(900);
  });
  it('should support ERC20 tokens that return no data', async function () {
    const { core, alice } = await loadFixture(deploy); const token = await ethers.deployContract('NoReturnToken');
    await token.mint(core.target, 100);
    await core.emergencyWithdrawERC20(token.target, alice, 40);
    expect(await token.balanceOf(alice)).eq(40); expect(await token.balanceOf(core.target)).eq(60);
  });
  it('should reject false-return tokens and remain usable after failure', async function () {
    const { core, token, alice } = await loadFixture(recoveryFixture); const bad = await ethers.deployContract('FalseReturnToken');
    await expect(core.emergencyWithdrawERC20(bad.target, alice, 1)).revertedWithCustomError(core, 'SafeERC20FailedOperation').withArgs(bad.target);
    await core.emergencyWithdrawERC20(token.target, alice, 10); expect(await token.balanceOf(alice)).eq(10);
  });
  it('should bubble ERC20 transfer failure and restore the custom guard', async function () {
    const { core, token, alice } = await loadFixture(recoveryFixture);
    await expect(core.emergencyWithdrawERC20(token.target, alice, 1001)).revertedWithCustomError(token, 'ERC20InsufficientBalance').withArgs(core.target, 1000, 1001);
    expect(await token.balanceOf(core.target)).eq(1000);
    await core.emergencyWithdrawERC20(token.target, alice, 1000); expect(await token.balanceOf(alice)).eq(1000);
  });
  for (const cross of [false, true]) it(`should block ${cross ? 'cross-function withdrawal' : 'same-function recovery'} reentrancy and avoid permanently locking the guard`, async function () {
    const { core, alice } = await loadFixture(deploy); const token = await ethers.deployContract('ReentrantToken', [core.target]);
    await core.transferOwnership(token.target); await token.configure(true, cross);
    // The callback sender owns the core: onlyOwner cannot mask a missing guard.
    const block = await ethers.provider.getBlockNumber();
    await expect(token.recover(alice, 100)).revertedWithCustomError(core, 'ReentrancyGuard');
    expect(await token.balanceOf(core.target)).eq(1000); expect(await token.balanceOf(alice)).eq(0); expect(await core.burnNonce()).eq(0);
    expect(await core.queryFilter(core.filters.EmergencyWithdrawERC20(), block + 1)).length(0);
    await token.configure(false, cross);
    for (let i = 0; i < 2; i++) await expect(token.recover(alice, 100)).emit(core, 'EmergencyWithdrawERC20').withArgs(token.target, alice.address, 100);
    expect(await token.balanceOf(core.target)).eq(800); expect(await token.balanceOf(alice)).eq(200);
  });
});
