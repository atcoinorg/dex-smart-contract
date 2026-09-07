const { ethers, expect, loadFixture, deploy, unauthorized } = require('./helpers/fixture');
describe('AccessControl public API and authority separation', function () {
  for (const name of ['Admin', 'Minter', 'Pauser']) {
    it(`should grant and revoke ${name} through helpers with custom and standard events`, async function () {
      const { core, owner, alice, roles } = await loadFixture(deploy); const role = roles[name];
      await expect(core[`grant${name}Role`](alice)).emit(core, 'RoleGranted').withArgs(role, alice.address, owner.address).and.emit(core, `Grant${name}RoleEvent`).withArgs(role, alice.address);
      expect(await core.hasRole(role, alice)).eq(true); expect(await core[`is${name}`](alice)).eq(true);
      await expect(core[`grant${name}Role`](alice)).revertedWithCustomError(core, 'RoleAlreadyGranted');
      await expect(core[`revoke${name}Role`](alice)).emit(core, 'RoleRevoked').withArgs(role, alice.address, owner.address).and.emit(core, `Revoke${name}RoleEvent`).withArgs(role, alice.address);
      expect(await core.hasRole(role, alice)).eq(false); expect(await core[`is${name}`](alice)).eq(false);
    });
    it(`should reject zero ${name} grant and enforce implemented revoke policy`, async function () {
      const { core, roles } = await loadFixture(deploy);
      await expect(core[`grant${name}Role`](ethers.ZeroAddress)).revertedWithCustomError(core, 'InvalidUserAddress');
      if (name !== 'Pauser') await expect(core[`revoke${name}Role`](ethers.ZeroAddress)).revertedWithCustomError(core, 'InvalidUserAddress');
      else await expect(core.revokePauserRole(ethers.ZeroAddress)).emit(core, 'RevokePauserRoleEvent').withArgs(roles.Pauser, ethers.ZeroAddress);
    });
    it(`should deny ordinary users and ADMIN-only accounts authority to grant or revoke ${name}`, async function () {
      const { core, alice, admin } = await loadFixture(deploy); await core.grantAdminRole(admin);
      for (const user of [alice, admin]) for (const action of ['grant', 'revoke']) await unauthorized(core.connect(user)[`${action}${name}Role`](alice), core, user, ethers.ZeroHash);
    });
    it(`should expose inherited grantRole, revokeRole and renounceRole for ${name}`, async function () {
      const { core, owner, alice, bob, roles } = await loadFixture(deploy); const role = roles[name];
      // AccessControl methods are public API; helper-only duplicate/zero-address rules do not apply.
      await expect(core.grantRole(role, alice)).emit(core, 'RoleGranted').withArgs(role, alice.address, owner.address);
      await expect(core.grantRole(role, alice)).not.emit(core, 'RoleGranted');
      await unauthorized(core.connect(alice).grantRole(role, bob), core, alice, ethers.ZeroHash);
      await unauthorized(core.connect(alice).revokeRole(role, owner), core, alice, ethers.ZeroHash);
      await expect(core.revokeRole(role, alice)).emit(core, 'RoleRevoked').withArgs(role, alice.address, owner.address);
      expect(await core.hasRole(role, alice)).eq(false);
      await core.grantRole(role, alice);
      await expect(core.connect(alice).renounceRole(role, bob)).revertedWithCustomError(core, 'AccessControlBadConfirmation');
      await expect(core.connect(alice).renounceRole(role, alice)).emit(core, 'RoleRevoked').withArgs(role, alice.address, alice.address);
      expect(await core.hasRole(role, alice)).eq(false);
      await core.grantRole(role, ethers.ZeroAddress); expect(await core.hasRole(role, ethers.ZeroAddress)).eq(true);
      await core.revokeRole(role, ethers.ZeroAddress); expect(await core.hasRole(role, ethers.ZeroAddress)).eq(false);
    });
  }
  it('should keep Ownable and DEFAULT_ADMIN independent after ownership transfer', async function () {
    const { core, owner, alice } = await loadFixture(deploy);
    await expect(core.connect(alice).transferOwnership(alice)).revertedWithCustomError(core, 'OwnableUnauthorizedAccount').withArgs(alice.address);
    await expect(core.transferOwnership(ethers.ZeroAddress)).revertedWithCustomError(core, 'OwnableInvalidOwner').withArgs(ethers.ZeroAddress);
    await expect(core.transferOwnership(alice)).emit(core, 'OwnershipTransferred').withArgs(owner.address, alice.address);
    expect(await core.owner()).eq(alice.address); expect(await core.isSuperAdmin(owner)).eq(true); expect(await core.isSuperAdmin(alice)).eq(false);
    await unauthorized(core.connect(alice).grantAdminRole(alice), core, alice, ethers.ZeroHash);
    await core.grantAdminRole(alice); expect(await core.isAdmin(alice)).eq(true);
  });
  it('should document DEFAULT_ADMIN renunciation leaving owner without role-management powers', async function () {
    const { core, owner, alice } = await loadFixture(deploy);
    await core.renounceRole(ethers.ZeroHash, owner);
    expect(await core.owner()).eq(owner.address); expect(await core.isSuperAdmin(owner)).eq(false);
    await unauthorized(core.grantMinterRole(alice), core, owner, ethers.ZeroHash);
  });
});
