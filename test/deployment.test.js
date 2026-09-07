const { ethers, expect, loadFixture, deploy, mint } = require('./helpers/fixture');
describe('Deployment and proxy isolation', function () {
  it('should deploy an initialized proxy with exact metadata and zero initial state', async function () {
    const { core, owner } = await loadFixture(deploy);
    expect(await core.name()).eq('EVM ATCOIN'); expect(await core.symbol()).eq('ATCOIN');
    expect(await core.decimals()).eq(8); expect(await core.owner()).eq(owner.address);
    for (const getter of ['totalSupply', 'mintDepositNonce', 'burnNonce']) expect(await core[getter]()).eq(0);
    for (const getter of ['mintPaused', 'burnPaused', 'paused']) expect(await core[getter]()).eq(false);
    expect(await core.MAX_BATCH()).eq(200); expect(await core.MAX_ATCOIN_UNITS()).eq(8820000000000000000n);
  });
  it('should grant all initial roles only to initialOwner', async function () {
    const { core, owner, stranger, roles } = await loadFixture(deploy);
    for (const role of [ethers.ZeroHash, ...Object.values(roles)]) {
      expect(await core.hasRole(role, owner)).eq(true); expect(await core.hasRole(role, stranger)).eq(false);
      expect(await core.getRoleAdmin(role)).eq(ethers.ZeroHash);
    }
  });
  it('should disable initialization on implementation and repeated initialization through proxy', async function () {
    const { core, implementation, owner, stranger } = await loadFixture(deploy);
    for (const contract of [core, implementation]) for (const caller of [owner, stranger]) {
      await expect(contract.connect(caller).initialize(caller.address)).revertedWithCustomError(contract, 'InvalidInitialization');
    }
    expect(await core.owner()).eq(owner.address);
  });
  it('should reject zero initial owner atomically during proxy deployment', async function () {
    const { implementation } = await loadFixture(deploy);
    await expect(ethers.deployContract('ATCOINProxy', [implementation.target, ethers.ZeroAddress])).revertedWithCustomError(implementation, 'OwnableInvalidOwner').withArgs(ethers.ZeroAddress);
  });
  it('should reject a proxy implementation without code', async function () {
    const { owner, stranger } = await loadFixture(deploy);
    const Proxy = await ethers.getContractFactory('ATCOINProxy');
    await expect(Proxy.deploy(stranger.address, owner.address)).revertedWithCustomError(Proxy, 'ERC1967InvalidImplementation').withArgs(stranger.address);
  });
  it('should keep balances, roles and initialization state isolated from direct implementation', async function () {
    const { core, implementation, owner, alice } = await loadFixture(deploy);
    await mint(core, [alice], [100n]);
    expect(await core.balanceOf(alice)).eq(100); expect(await implementation.balanceOf(alice)).eq(0);
    expect(await implementation.totalSupply()).eq(0); expect(await implementation.owner()).eq(ethers.ZeroAddress);
    expect(await implementation.hasRole(ethers.ZeroHash, owner)).eq(false);
    expect(await implementation.mintDepositNonce()).eq(0);
  });
  it('should expose ERC1967 UUID only directly and prevent delegated proxiableUUID', async function () {
    const { core, implementation } = await loadFixture(deploy);
    expect(await implementation.proxiableUUID()).eq('0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc');
    await expect(core.proxiableUUID()).revertedWithCustomError(core, 'UUPSUnauthorizedCallContext');
    await expect(implementation.upgradeToAndCall(implementation.target, '0x')).revertedWithCustomError(core, 'UUPSUnauthorizedCallContext');
  });
});
