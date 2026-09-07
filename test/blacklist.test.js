const { ethers, expect, loadFixture, deploy, mint, snapshot, unauthorized } = require('./helpers/fixture');
async function fundedBlacklist() { const f = await deploy(); await mint(f.core, [f.alice], [1000]); return f; }
describe('Blacklist and allowance bypass security', function () {
  it('should allow only ADMIN to update nonzero users and emit exact state', async function () {
    const { core, alice, admin, roles } = await loadFixture(deploy);
    for (const value of [true, false]) await unauthorized(core.connect(alice).setBlacklist(alice, value), core, alice, roles.Admin);
    await core.grantAdminRole(admin);
    await expect(core.connect(admin).setBlacklist(ethers.ZeroAddress, true)).revertedWithCustomError(core, 'InvalidUserAddress');
    for (const value of [true, false]) {
      await expect(core.connect(admin).setBlacklist(alice, value)).emit(core, 'BlacklistUpdatedEvent').withArgs(alice.address, value);
      expect(await core.isBlacklisted(alice)).eq(value); expect(await core.blacklisted(alice)).eq(value);
    }
  });
  for (const participant of ['alice', 'bob']) it(`should block transfer with blacklisted ${participant === 'alice' ? 'sender' : 'recipient'} and restore after removal`, async function () {
    const f = await loadFixture(fundedBlacklist); const { core, alice, bob } = f;
    await core.setBlacklist(f[participant], true); const before = await snapshot(core, [alice, bob]);
    await expect(core.connect(alice).transfer(bob, 100)).revertedWithCustomError(core, 'BlackListed');
    expect(await snapshot(core, [alice, bob])).deep.eq(before);
    await core.setBlacklist(f[participant], false); await core.connect(alice).transfer(bob, 100);
    expect(await core.balanceOf(bob)).eq(100);
  });
  for (const allowance of [200n, ethers.MaxUint256]) for (const participant of ['mallory', 'alice', 'bob']) {
    it(`should prevent blacklisted ${participant === 'mallory' ? 'spender from bypassing blacklist' : participant === 'alice' ? 'owner' : 'recipient'} via transferFrom with ${allowance === ethers.MaxUint256 ? 'infinite' : 'finite'} allowance`, async function () {
      const f = await loadFixture(fundedBlacklist); const { core, alice, bob, mallory } = f;
      await core.connect(alice).approve(mallory, allowance);
      await core.connect(mallory).transferFrom(alice, bob, 100);
      await core.connect(alice).approve(mallory, allowance);
      await core.setBlacklist(f[participant], true);
      for (const user of [alice, bob, mallory]) expect(await core.isBlacklisted(user)).eq(user === f[participant]);
      const before = await snapshot(core, [alice, bob, mallory]);
      await expect(core.connect(mallory).transferFrom(alice, bob, 100)).revertedWithCustomError(core, 'BlackListed');
      expect(await core.allowance(alice, mallory)).eq(allowance); expect(await snapshot(core, [alice, bob, mallory])).deep.eq(before);
      await core.setBlacklist(f[participant], false);
      await core.connect(mallory).transferFrom(alice, bob, 100);
      expect(await core.allowance(alice, mallory)).eq(allowance === ethers.MaxUint256 ? allowance : allowance - 100n);
      expect(await core.balanceOf(bob)).eq(200);
    });
  }
  it('should document that approve remains permitted while blacklisted but spending does not', async function () {
    const { core, alice, bob, mallory } = await loadFixture(fundedBlacklist);
    await core.setBlacklist(alice, true);
    await expect(core.connect(alice).approve(mallory, 100)).emit(core, 'Approval').withArgs(alice.address, mallory.address, 100);
    await expect(core.connect(mallory).transferFrom(alice, bob, 0)).revertedWithCustomError(core, 'BlackListed');
  });
  it('should preserve standard insufficient allowance and balance custom errors', async function () {
    const { core, alice, bob, mallory } = await loadFixture(fundedBlacklist);
    await expect(core.connect(mallory).transferFrom(alice, bob, 1)).revertedWithCustomError(core, 'ERC20InsufficientAllowance').withArgs(mallory.address, 0, 1);
    await core.connect(alice).approve(mallory, 2000);
    await expect(core.connect(mallory).transferFrom(alice, bob, 1001)).revertedWithCustomError(core, 'ERC20InsufficientBalance').withArgs(alice.address, 1000, 1001);
    expect(await core.allowance(alice, mallory)).eq(2000);
  });
});
