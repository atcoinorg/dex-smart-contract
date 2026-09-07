const { expect, loadFixture, deploy, mint, snapshot } = require('./helpers/fixture');
function rng(seed) { let x = seed >>> 0; return n => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) % n; }; }
describe('Seeded model-based invariants', function () {
  for (const seed of [0xa7c01, 0x12345678, 0xc0ffee]) it(`should maintain exact supply and balances across randomized operations (seed ${seed})`, async function () {
    const { core, alice, bob, mallory, stranger, min, max, cap } = await loadFixture(deploy);
    const users = [alice, bob, mallory, stranger], balances = users.map(() => 0n), blocked = users.map(() => false);
    const random = rng(seed); let supply = 0n, mintNonce = 0n, burnNonce = 0n;
    for (let step = 0; step < 100; step++) {
      const op = step % 5, a = random(users.length), b = random(users.length);
      if (op === 0) {
        const size = 1 + random(max), indices = Array.from({ length: size }, () => random(users.length));
        const amounts = indices.map(() => BigInt(random(100000001)));
        const before = await snapshot(core, users);
        const tx = mint(core, indices.map(i => users[i]), amounts);
        if (indices.some(i => blocked[i])) { await expect(tx).revertedWithCustomError(core, 'BlackListed'); expect(await snapshot(core, users)).deep.eq(before); }
        else { await tx; indices.forEach((i, j) => { balances[i] += amounts[j]; supply += amounts[j]; }); mintNonce += BigInt(size); }
      } else if (op === 1 || op === 4) {
        blocked[a] = !blocked[a]; await core.setBlacklist(users[a], blocked[a]);
        expect(await core.isBlacklisted(users[a])).eq(blocked[a]);
      } else if (op === 2) {
        const amount = BigInt(random(100000001)); const before = await snapshot(core, users);
        const tx = core.connect(users[a]).transfer(users[b], amount);
        const error = blocked[a] || blocked[b] ? 'BlackListed' : amount > balances[a] ? 'ERC20InsufficientBalance' : null;
        if (error) { await expect(tx).revertedWithCustomError(core, error); expect(await snapshot(core, users)).deep.eq(before); }
        else { await tx; balances[a] -= amount; balances[b] += amount; }
      } else {
        // Exercise both successful burns and deterministic failures, including exact minimum.
        const amount = step % 2 ? min : BigInt(random(150000001)); const before = await snapshot(core, users);
        const tx = core.connect(users[a]).withdrawalRequest(amount, `seed-${seed}-${step}`);
        const error = blocked[a] ? 'BlackListed' : amount > balances[a] ? 'InsufficientBalance' : amount < min ? 'AmountTooLow' : null;
        if (error) { await expect(tx).revertedWithCustomError(core, error); expect(await snapshot(core, users)).deep.eq(before); }
        else {
          await tx; balances[a] -= amount; supply -= amount; burnNonce++;
          expect(await core.balanceOf(users[a])).eq(before.balances[a] - amount); expect(await core.totalSupply()).eq(before.supply - amount);
        }
      }
      const actual = await snapshot(core, users);
      expect(actual).deep.eq({ supply, mint: mintNonce, burn: burnNonce, balances });
      expect(actual.supply).lte(cap); expect(actual.balances.reduce((a, b) => a + b, 0n)).eq(supply); // All holders are modeled, hence equality is stronger than <=.
    }
    expect(mintNonce).gt(0); expect(burnNonce).gt(0);
  });
  it('should preserve cap under randomized near-cap mint/burn cycles', async function () {
    const { core, alice, min, cap } = await loadFixture(deploy); const random = rng(42);
    await mint(core, [alice], [cap]);
    for (let i = 0; i < 25; i++) {
      const amount = min + BigInt(random(100000000)); await core.connect(alice).withdrawalRequest(amount, 'w');
      const before = await snapshot(core, [alice]);
      await expect(mint(core, [alice], [amount + 1n])).revertedWithCustomError(core, 'ExceedsMaxSupply');
      expect(await snapshot(core, [alice])).deep.eq(before);
      await mint(core, [alice], [amount]); expect(await core.totalSupply()).eq(cap); expect(await core.balanceOf(alice)).eq(cap);
    }
  });
});
