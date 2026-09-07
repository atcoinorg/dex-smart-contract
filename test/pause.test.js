const { expect, loadFixture, deploy, mint, unauthorized } = require('./helpers/fixture');
async function fundedPause() { const f = await deploy(); await mint(f.core, [f.alice], [f.min * 10n]); return f; }
describe('Independent pause controls', function () {
  for (const method of ['pause', 'unpause', 'pauseByMint', 'unpauseByMint', 'pauseByBurn', 'unpauseByBurn']) {
    it(`should require PAUSER for ${method}`, async function () {
      const { core, alice, roles } = await loadFixture(deploy);
      await unauthorized(core.connect(alice)[method](), core, alice, roles.Pauser);
    });
  }
  for (const mode of ['Mint', 'Burn']) it(`should enforce ${mode} pause independently and emit only state-change events`, async function () {
    const { core, alice, bob, pauser, min } = await loadFixture(fundedPause);
    await core.grantPauserRole(pauser);
    const c = core.connect(pauser), field = mode.toLowerCase() + 'Paused';
    await expect(c[`pauseBy${mode}`]()).emit(core, `PausedBy${mode}Event`).withArgs(pauser.address);
    expect(await core[field]()).eq(true);
    await expect(c[`pauseBy${mode}`]()).not.emit(core, `PausedBy${mode}Event`);
    if (mode === 'Mint') {
      await expect(mint(core, [alice], [min])).revertedWithCustomError(core, 'MintPaused');
      await core.connect(alice).withdrawalRequest(min, 'w');
    } else {
      await expect(core.connect(alice).withdrawalRequest(min, 'w')).revertedWithCustomError(core, 'BurnPaused');
      await mint(core, [alice], [min]);
    }
    await core.connect(alice).transfer(bob, 1); expect(await core.balanceOf(bob)).eq(1);
    await expect(c[`unpauseBy${mode}`]()).emit(core, `UnpausedBy${mode}Event`).withArgs(pauser.address);
    expect(await core[field]()).eq(false);
    await expect(c[`unpauseBy${mode}`]()).not.emit(core, `UnpausedBy${mode}Event`);
    await mint(core, [alice], [min]); await core.connect(alice).withdrawalRequest(min, 'w');
  });
  it('should globally block transfer and transferFrom but permit independently enabled mint and burn', async function () {
    const { core, owner, alice, bob, mallory, min } = await loadFixture(fundedPause);
    await core.connect(alice).approve(mallory, min);
    await expect(core.pause()).emit(core, 'Paused').withArgs(owner.address).and.emit(core, 'PausedEvent').withArgs(owner.address);
    expect(await core.paused()).eq(true);
    await expect(core.connect(alice).transfer(bob, 1)).revertedWithCustomError(core, 'TransfersPaused');
    await expect(core.connect(mallory).transferFrom(alice, bob, 1)).revertedWithCustomError(core, 'TransfersPaused');
    expect(await core.allowance(alice, mallory)).eq(min);
    await mint(core, [alice], [min]); await core.connect(alice).withdrawalRequest(min, 'w');
    await expect(core.pause()).revertedWithCustomError(core, 'EnforcedPause');
    await expect(core.unpause()).emit(core, 'Unpaused').withArgs(owner.address).and.emit(core, 'UnpausedEvent').withArgs(owner.address);
    expect(await core.paused()).eq(false);
    await core.connect(alice).transfer(bob, 1); await core.connect(mallory).transferFrom(alice, bob, 1);
    expect(await core.balanceOf(bob)).eq(2);
    await expect(core.unpause()).revertedWithCustomError(core, 'ExpectedPause');
  });
});
