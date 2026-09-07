const { upgrades, artifacts } = require('hardhat');
const { ethers, expect, loadFixture, deploy, mint, complete, unauthorized } = require('./helpers/fixture');
// Production constructor only disables initializers; no storage checks are bypassed.
const validationOptions = { kind: 'uups', unsafeAllow: ['constructor'] };
async function upgradeFixture() { const f = await deploy(); f.v2 = await ethers.deployContract('ATCOINCoreV2'); return f; }
async function state(core, users, roles) {
  const result = {};
  for (const key of ['name', 'symbol', 'decimals', 'totalSupply', 'mintDepositNonce', 'burnNonce', 'mintPaused', 'burnPaused', 'paused', 'owner', 'MAX_ATCOIN_UNITS', 'MIN_WITHDRAW', 'MAX_BATCH']) result[key] = await core[key]();
  result.balances = await Promise.all(users.map(u => core.balanceOf(u)));
  result.blacklist = await Promise.all(users.map(u => core.isBlacklisted(u)));
  result.allowances = await Promise.all(users.flatMap(a => users.map(b => core.allowance(a, b))));
  result.roles = await Promise.all(roles.flatMap(r => users.map(u => core.hasRole(r, u))));
  result.roleAdmins = await Promise.all(roles.map(r => core.getRoleAdmin(r)));
  result.completed = await Promise.all([0, 1, 2, 3, 4, 100].map(n => core.burnNonceListCompleted(n)));
  return result;
}
describe('UUPS authorization and storage preservation', function () {
  it('should validate current-to-V2 storage compatibility with OpenZeppelin', async function () {
    await upgrades.validateUpgrade(await ethers.getContractFactory('ATCOINCore'), await ethers.getContractFactory('ATCOINCoreV2'), validationOptions);
  });
  it('should prove the layout gate rejects a changed production storage slot', async function () {
    // Mutate build metadata in memory only: negative control proves incompatibility is fatal.
    const { assertStorageUpgradeSafe } = require('@openzeppelin/upgrades-core');
    const info = await artifacts.getBuildInfo('contracts/ATCOINCore.sol:ATCOINCore');
    const layout = info.output.contracts['contracts/ATCOINCore.sol'].ATCOINCore.storageLayout;
    const bad = structuredClone(layout); bad.storage.find(v => v.label === 'mintDepositNonce').slot = '999';
    expect(() => assertStorageUpgradeSafe(layout, bad)).to.throw(/incompatible/i);
  });
  for (const who of ['stranger', 'admin', 'minter', 'pauser']) it(`should reject upgrades by ${who} without DEFAULT_ADMIN`, async function () {
    const f = await loadFixture(upgradeFixture); const { core, v2, admin, minter, pauser } = f;
    await core.grantAdminRole(admin); await core.grantMinterRole(minter); await core.grantPauserRole(pauser);
    const old = await upgrades.erc1967.getImplementationAddress(core.target);
    await unauthorized(core.connect(f[who]).upgradeToAndCall(v2.target, '0x'), core, f[who], ethers.ZeroHash);
    expect(await upgrades.erc1967.getImplementationAddress(core.target)).eq(old);
  });
  it('should allow a DEFAULT_ADMIN-only account to upgrade without Ownable or operational roles', async function () {
    const { core, v2, stranger, owner } = await loadFixture(upgradeFixture);
    await core.grantRole(ethers.ZeroHash, stranger);
    await expect(core.connect(stranger).upgradeToAndCall(v2.target, '0x')).emit(core, 'Upgraded').withArgs(v2.target);
    const next = await ethers.getContractAt('ATCOINCoreV2', core.target);
    expect(await next.version()).eq(2); expect(next.target).eq(core.target); expect(await next.owner()).eq(owner.address);
    await expect(v2.initialize(owner)).revertedWithCustomError(v2, 'InvalidInitialization');
  });
  it('should reject non-UUPS, EOA, wrong UUID and proxy-as-implementation targets', async function () {
    const { core, stranger } = await loadFixture(upgradeFixture);
    const ordinary = await ethers.deployContract('MockERC20'); const wrong = await ethers.deployContract('WrongUUID');
    const old = await upgrades.erc1967.getImplementationAddress(core.target);
    // An EOA returns empty data: Solidity ABI decoding fails outside the external-call catch.
    await expect(core.upgradeToAndCall(stranger.address, '0x')).revertedWithoutReason();
    for (const target of [ordinary.target, core.target]) await expect(core.upgradeToAndCall(target, '0x')).revertedWithCustomError(core, 'ERC1967InvalidImplementation').withArgs(target);
    await expect(core.upgradeToAndCall(wrong.target, '0x')).revertedWithCustomError(core, 'UUPSUnsupportedProxiableUUID').withArgs(ethers.zeroPadValue('0x7b', 32));
    expect(await upgrades.erc1967.getImplementationAddress(core.target)).eq(old);
  });
  it('should roll back implementation change when upgrade calldata reverts', async function () {
    const { core, v2, owner } = await loadFixture(upgradeFixture); const old = await upgrades.erc1967.getImplementationAddress(core.target);
    await expect(core.upgradeToAndCall(v2.target, core.interface.encodeFunctionData('initialize', [owner.address]))).revertedWithCustomError(core, 'InvalidInitialization');
    expect(await upgrades.erc1967.getImplementationAddress(core.target)).eq(old);
  });
  it('should preserve all populated state, namespaced ERC20 data, authority and guard across upgrade', async function () {
    const { core, v2, owner, alice, bob, mallory, admin, minter, pauser, stranger, roles, min } = await loadFixture(upgradeFixture);
    await core.grantAdminRole(admin); await core.grantMinterRole(minter); await core.grantPauserRole(pauser);
    await core.grantRole(ethers.ZeroHash, stranger);
    await mint(core.connect(minter), [alice, bob, mallory], [20n * min, 30n * min, 5n * min]);
    await core.connect(alice).approve(mallory, 12345); await core.connect(bob).approve(alice, ethers.MaxUint256);
    for (const user of [alice, bob, alice]) await core.connect(user).withdrawalRequest(min, 'destination');
    await complete(core.connect(admin), [alice, alice], [min, min], [1, 3]);
    await core.connect(admin).setBlacklist(mallory, true);
    await core.transferOwnership(bob); await core.revokeMinterRole(owner);
    await core.pauseByMint(); await core.pauseByBurn(); await core.pause();
    const users = [owner, alice, bob, mallory, admin, minter, pauser, stranger, core.target, ethers.ZeroAddress]; const allRoles = [ethers.ZeroHash, ...Object.values(roles)];
    const before = await state(core, users, allRoles);
    // Include private _status and all conventional local slots, in addition to public namespaced state.
    const slots = await Promise.all(Array.from({ length: 6 }, (_, i) => ethers.provider.getStorage(core.target, i)));
    await upgrades.validateUpgrade(await ethers.getContractFactory('ATCOINCore'), await ethers.getContractFactory('ATCOINCoreV2'), validationOptions);
    await core.connect(stranger).upgradeToAndCall(v2.target, '0x');
    const next = await ethers.getContractAt('ATCOINCoreV2', core.target);
    expect(await next.version()).eq(2); expect(await state(next, users, allRoles)).deep.eq(before);
    expect(await Promise.all(Array.from({ length: 6 }, (_, i) => ethers.provider.getStorage(next.target, i)))).deep.eq(slots);
    expect(await upgrades.erc1967.getImplementationAddress(next.target)).eq(v2.target);
    await expect(next.initialize(owner)).revertedWithCustomError(next, 'InvalidInitialization');
    await next.connect(pauser).unpauseByMint(); await next.connect(pauser).unpauseByBurn(); await next.connect(pauser).unpause();
    await mint(next.connect(minter), [alice], [min]); expect(await next.mintDepositNonce()).eq(4);
    await next.connect(alice).withdrawalRequest(min, 'after-upgrade'); expect(await next.burnNonce()).eq(4);
    await complete(next.connect(admin), [alice], [min], [4]); expect(await next.burnNonceListCompleted(4)).eq(true);
    await next.connect(bob).transfer(alice, 1);
  });
});
