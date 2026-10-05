import { ethers, expect, loadFixture, deploy, mint, complete, events } from './helpers/fixture.js';
describe('MAX_BATCH gas sanity (local chain; no target network configured)', function () {
  for (const size of [1, 10, 100, 200]) it(`should execute mint batch ${size} below the local block gas limit`, async function () {
    const { core, cap } = await loadFixture(deploy);
    // Distinct fresh recipients force a new balance slot for every element.
    const users = Array.from({ length: size }, (_, i) => ethers.getAddress(ethers.toBeHex(10000 + i, 20)));
    const receipt = await (await mint(core, users, users.map(() => 1), users.map(() => 't4atcoin1' + 'w'.repeat(59)), users.map(() => 'a'.repeat(64)))).wait();
    const block = await ethers.provider.getBlock(receipt.blockNumber);
    console.log(`    GAS mint ${size}: ${receipt.gasUsed} / block ${block.gasLimit} (68-byte wallet and 64-byte tx ID)`);
    expect(receipt.gasUsed).lt(block.gasLimit); expect(events(core, receipt, 'DepositMinted')).length(size);
    expect(await core.totalSupply()).eq(size); expect(await core.totalSupply()).lte(cap);
  });
  for (const size of [1, 200]) it(`should execute completion batch ${size} with real unique burns below local block limit`, async function () {
    const { core, alice, min, max } = await loadFixture(deploy); expect(max).eq(200);
    const wallet = 't4atcoin1' + 'a'.repeat(59);
    await mint(core, [alice], [min * BigInt(size)], [wallet]);
    await core.connect(alice).registerEVMATCOINToATCOINWallet(wallet);
    for (let i = 0; i < size; i++) await core.connect(alice).withdrawalRequest(min);
    const nonces = Array.from({ length: size }, (_, i) => i + 1);
    const receipt = await (await complete(core, Array(size).fill(alice), Array(size).fill(min), nonces, Array(size).fill('a'.repeat(64)))).wait();
    const block = await ethers.provider.getBlock(receipt.blockNumber);
    console.log(`    GAS completion ${size}: ${receipt.gasUsed} / block ${block.gasLimit} (64-byte tx ID)`);
    expect(receipt.gasUsed).lt(block.gasLimit); expect(events(core, receipt, 'WithdrawCompleted')).length(size);
    for (const nonce of nonces) expect(await core.burnNonceListCompleted(nonce)).eq(true);
    expect(await core.totalSupply()).eq(0); expect(await core.burnNonce()).eq(size);
  });
});
