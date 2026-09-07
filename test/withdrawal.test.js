const { expect, loadFixture, deploy, mint, complete, events, snapshot, unauthorized } = require('./helpers/fixture');
async function funded() { const f = await deploy(); await mint(f.core, [f.alice, f.bob], [f.min * 10n, f.min * 10n]); return f; }
async function withdrawn() { const f = await funded(); await f.core.connect(f.alice).withdrawalRequest(f.min, 'alice-source'); await f.core.connect(f.bob).withdrawalRequest(f.min, 'bob-source'); return f; }
describe('Withdrawal burns', function () {
  it('should burn only caller tokens and assign globally sequential withdrawal nonces', async function () {
    const { core, alice, bob, min } = await loadFixture(funded);
    for (const [i, user] of [alice, bob, alice].entries()) {
      const before = await snapshot(core, [user]);
      await expect(core.connect(user).withdrawalRequest(min, `destination-${i}`)).emit(core, 'WithdrawRequested').withArgs(user.address, min, `destination-${i}`, i + 1).and.emit(core, 'Transfer').withArgs(user.address, require('hardhat').ethers.ZeroAddress, min);
      expect(await core.balanceOf(user)).eq(before.balances[0] - min); expect(await core.totalSupply()).eq(before.supply - min); expect(await core.burnNonce()).eq(i + 1);
    }
  });
  for (const [label, error] of [['below minimum', 'AmountTooLow'], ['zero', 'AmountTooLow'], ['above balance', 'InsufficientBalance'], ['blacklisted', 'BlackListed'], ['burn paused', 'BurnPaused']]) {
    it(`should reject ${label} withdrawal without changing balances, supply or nonce`, async function () {
      const { core, alice, bob, min } = await loadFixture(funded);
      if (label === 'blacklisted') await core.setBlacklist(alice, true);
      if (label === 'burn paused') await core.pauseByBurn();
      const amount = label === 'below minimum' ? min - 1n : label === 'zero' ? 0n : label === 'above balance' ? min * 10n + 1n : min;
      const before = await snapshot(core, [alice, bob]);
      await expect(core.connect(alice).withdrawalRequest(amount, 'destination')).revertedWithCustomError(core, error);
      expect(await snapshot(core, [alice, bob])).deep.eq(before);
      if (label === 'blacklisted') await core.setBlacklist(alice, false);
      if (label === 'burn paused') await core.unpauseByBurn();
      await core.connect(alice).withdrawalRequest(min, 'recovery'); expect(await core.burnNonce()).eq(1);
    });
  }
  it('should document empty destination as currently accepted for a minimum withdrawal', async function () {
    const { core, alice, min } = await loadFixture(funded);
    // Destination validation belongs to the current off-chain bridge policy.
    await expect(core.connect(alice).withdrawalRequest(min, '')).emit(core, 'WithdrawRequested').withArgs(alice.address, min, '', 1);
    expect(await core.balanceOf(alice)).eq(min * 9n);
  });
});
describe('Trusted withdrawal completion', function () {
  it('should require ADMIN rather than MINTER or an ordinary account', async function () {
    const { core, alice, minter, min, roles } = await loadFixture(withdrawn);
    await core.grantMinterRole(minter);
    for (const caller of [alice, minter]) await unauthorized(complete(core.connect(caller), [alice], [min], [1]), core, caller, roles.Admin);
  });
  for (const index of [-1, 0, 1, 2, 3]) it(`should reject empty or mismatched completion arrays (case ${index})`, async function () {
    const { core, alice } = await loadFixture(withdrawn);
    const args = [[alice.address], [1], ['tx'], [1]];
    if (index === -1) args.forEach(a => a.pop()); else args[index] = [];
    await expect(core.batchWithdrawCompleted(...args)).revertedWithCustomError(core, 'LenMismatch');
    expect(await core.burnNonceListCompleted(1)).eq(false);
  });
  it('should complete each valid unique nonce once while skipping zero, future and duplicates', async function () {
    const { core, alice, bob, min } = await loadFixture(withdrawn);
    expect(await core.burnNonceListCompleted(1)).eq(false); expect(await core.burnNonceListCompleted(2)).eq(false);
    const before = await snapshot(core, [alice, bob]);
    const receipt = await (await complete(core, [alice, bob, bob, alice, bob], [min, min, min, min, min], [1, 0, 2, 1, 102])).wait();
    const logs = events(core, receipt, 'WithdrawCompleted'); expect(logs.length).eq(2);
    expect(Array.from(logs[0].args)).deep.eq([alice.address, min, 'out-0', 1n]); expect(Array.from(logs[1].args)).deep.eq([bob.address, min, 'out-2', 2n]);
    for (const nonce of [1, 2]) expect(await core.burnNonceListCompleted(nonce)).eq(true);
    for (const nonce of [0, 102]) expect(await core.burnNonceListCompleted(nonce)).eq(false);
    const repeated = await (await complete(core, [alice, bob], [min, min], [1, 2])).wait(); expect(events(core, repeated, 'WithdrawCompleted')).length(0);
    expect(await snapshot(core, [alice, bob])).deep.eq(before);
  });
  it('should reject MAX_BATCH + 1 completion records', async function () {
    const { core, alice, max } = await loadFixture(withdrawn);
    await expect(complete(core, Array(max + 1).fill(alice), Array(max + 1).fill(1), Array(max + 1).fill(1))).revertedWithCustomError(core, 'BatchTooLarge');
    expect(await core.burnNonceListCompleted(1)).eq(false);
  });
  it('should document trusted reports accepting unrelated recipient, amount and empty tx ID', async function () {
    const { core, stranger } = await loadFixture(withdrawn);
    // Only nonce validity is checked; the report does not authenticate payment or match the burn.
    await expect(complete(core, [stranger], [0], [1], [''])).emit(core, 'WithdrawCompleted').withArgs(stranger.address, 0, '', 1);
    expect(await core.burnNonceListCompleted(1)).eq(true);
  });
});
module.exports = { funded, withdrawn };
