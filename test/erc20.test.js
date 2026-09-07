const { ethers, expect, loadFixture, deploy, mint, snapshot } = require('./helpers/fixture');
async function fundedERC20() { const f = await deploy(); await mint(f.core, [f.alice], [1000]); return f; }
describe('ERC20 inherited behavior through proxy', function () {
  it('should emit exact Transfer and Approval events without changing supply', async function () {
    const { core, alice, bob, mallory } = await loadFixture(fundedERC20);
    await expect(core.connect(alice).transfer(bob, 100)).emit(core, 'Transfer').withArgs(alice.address, bob.address, 100);
    await expect(core.connect(alice).approve(mallory, 200)).emit(core, 'Approval').withArgs(alice.address, mallory.address, 200);
    await expect(core.connect(mallory).transferFrom(alice, bob, 150)).emit(core, 'Transfer').withArgs(alice.address, bob.address, 150);
    expect(await core.balanceOf(alice)).eq(750); expect(await core.balanceOf(bob)).eq(250);
    expect(await core.allowance(alice, mallory)).eq(50); expect(await core.totalSupply()).eq(1000);
    expect(await core.mintDepositNonce()).eq(1); expect(await core.burnNonce()).eq(0);
  });
  it('should permit self and zero transfers while preserving balances and nonces', async function () {
    const { core, alice, bob } = await loadFixture(fundedERC20); const before = await snapshot(core, [alice, bob]);
    await expect(core.connect(alice).transfer(alice, 1000)).emit(core, 'Transfer').withArgs(alice.address, alice.address, 1000);
    await expect(core.connect(bob).transfer(alice, 0)).emit(core, 'Transfer').withArgs(bob.address, alice.address, 0);
    expect(await snapshot(core, [alice, bob])).deep.eq(before);
  });
  it('should reject zero transfer recipient and zero approval spender precisely', async function () {
    const { core, alice, mallory } = await loadFixture(fundedERC20);
    await expect(core.connect(alice).transfer(ethers.ZeroAddress, 1)).revertedWithCustomError(core, 'ERC20InvalidReceiver').withArgs(ethers.ZeroAddress);
    await expect(core.connect(alice).approve(ethers.ZeroAddress, 1)).revertedWithCustomError(core, 'ERC20InvalidSpender').withArgs(ethers.ZeroAddress);
    await core.connect(alice).approve(mallory, 10);
    await expect(core.connect(mallory).transferFrom(alice, ethers.ZeroAddress, 1)).revertedWithCustomError(core, 'ERC20InvalidReceiver').withArgs(ethers.ZeroAddress);
    expect(await core.allowance(alice, mallory)).eq(10); expect(await core.balanceOf(alice)).eq(1000);
  });
  it('should expose AccessControl ERC165 support and reject an unknown interface', async function () {
    const { core } = await loadFixture(deploy);
    expect(await core.supportsInterface('0x01ffc9a7')).eq(true); expect(await core.supportsInterface('0x7965db0b')).eq(true);
    expect(await core.supportsInterface('0xffffffff')).eq(false);
  });
});
