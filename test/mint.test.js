const { ethers, expect, loadFixture, deploy, mint, events, snapshot, unauthorized } = require('./helpers/fixture');
describe('Deposit mint and cap security', function () {
  it('should allow a dedicated minter and reject users and ADMIN without MINTER', async function () {
    const { core, alice, admin, minter, roles } = await loadFixture(deploy);
    await core.grantAdminRole(admin); await core.grantMinterRole(minter);
    for (const caller of [alice, admin]) await unauthorized(mint(core.connect(caller), [alice], [1]), core, caller, roles.Minter);
    await mint(core.connect(minter), [alice], [1]); expect(await core.balanceOf(alice)).eq(1);
  });
  it('should not let DEFAULT_ADMIN mint after its MINTER role was revoked', async function () {
    const { core, owner, alice, roles } = await loadFixture(deploy);
    await core.revokeMinterRole(owner);
    expect(await core.hasRole(ethers.ZeroHash, owner)).eq(true);
    await unauthorized(mint(core, [alice], [1]), core, owner, roles.Minter);
  });
  for (const index of [-1, 0, 1, 2, 3]) it(`should reject empty or mismatched mint arrays (case ${index})`, async function () {
    const { core, alice } = await loadFixture(deploy);
    const args = [[alice.address], [1], ['wallet'], ['tx']];
    if (index === -1) args.forEach(a => a.pop()); else args[index] = [];
    await expect(core.batchMintDepositEVMATCOINHandler(...args)).revertedWithCustomError(core, 'LenMismatch');
    expect(await core.mintDepositNonce()).eq(0); expect(await core.totalSupply()).eq(0);
  });
  for (const n of [1, 200]) it(`should mint a batch of ${n} with sequential nonces and exact event fields`, async function () {
    const { core, alice, bob } = await loadFixture(deploy);
    const users = Array.from({ length: n }, (_, i) => i % 2 ? bob : alice);
    const amounts = users.map((_, i) => BigInt(i + 1));
    const receipt = await (await mint(core, users, amounts)).wait();
    const logs = events(core, receipt, 'DepositMinted'); expect(logs.length).eq(n);
    for (let i = 0; i < n; i++) expect(Array.from(logs[i].args)).deep.eq([users[i].address, amounts[i], `wallet-${i}`, `tx-${i}`, BigInt(i + 1)]);
    for (const user of [alice, bob]) expect(await core.balanceOf(user)).eq(amounts.reduce((s, a, i) => s + (users[i] === user ? a : 0n), 0n));
    expect(await core.totalSupply()).eq(amounts.reduce((s, a) => s + a, 0n)); expect(await core.mintDepositNonce()).eq(n);
    await expect(mint(core, [bob], [1])).emit(core, 'DepositMinted').withArgs(bob.address, 1, 'wallet-0', 'tx-0', n + 1);
  });
  it('should reject MAX_BATCH + 1 without changing state', async function () {
    const { core, alice, max } = await loadFixture(deploy);
    await expect(mint(core, Array(max + 1).fill(alice), Array(max + 1).fill(1))).revertedWithCustomError(core, 'BatchTooLarge');
    expect(await core.totalSupply()).eq(0); expect(await core.mintDepositNonce()).eq(0);
  });
  it('should allow the exact cap, reject one additional unit, and reuse burned supply', async function () {
    const { core, alice, cap, min } = await loadFixture(deploy);
    await mint(core, [alice], [cap]); expect(await core.totalSupply()).eq(cap);
    const before = await snapshot(core, [alice]);
    await expect(mint(core, [alice], [1])).revertedWithCustomError(core, 'ExceedsMaxSupply');
    expect(await snapshot(core, [alice])).deep.eq(before);
    await core.connect(alice).withdrawalRequest(min, 'source'); await mint(core, [alice], [min]);
    expect(await core.totalSupply()).eq(cap); expect(await core.balanceOf(alice)).eq(cap);
  });
  it('should atomically reject a batch whose sum exceeds cap even when individual entries fit', async function () {
    const { core, alice, bob, cap } = await loadFixture(deploy);
    const before = await snapshot(core, [alice, bob]);
    await expect(mint(core, [alice, bob], [cap, 1])).revertedWithCustomError(core, 'ExceedsMaxSupply');
    expect(await snapshot(core, [alice, bob])).deep.eq(before);
  });
  for (const failure of ['zero address', 'blacklisted recipient']) it(`should roll back earlier mints, nonces and events for a later ${failure}`, async function () {
    const { core, alice, bob } = await loadFixture(deploy);
    await mint(core, [alice], [7]);
    if (failure !== 'zero address') await core.setBlacklist(bob, true);
    const before = await snapshot(core, [alice, bob]); const block = await ethers.provider.getBlockNumber();
    const call = mint(core, [alice, failure === 'zero address' ? ethers.ZeroAddress : bob], [10, 20]);
    if (failure === 'zero address') await expect(call).revertedWithCustomError(core, 'ERC20InvalidReceiver').withArgs(ethers.ZeroAddress);
    else await expect(call).revertedWithCustomError(core, 'BlackListed');
    expect(await snapshot(core, [alice, bob])).deep.eq(before);
    expect(await core.queryFilter(core.filters.DepositMinted(), block + 1)).length(0);
    expect(await core.queryFilter(core.filters.Transfer(), block + 1)).length(0);
  });
  it('should document zero mint and empty source metadata as permitted event-only records', async function () {
    const { core, alice } = await loadFixture(deploy);
    // Current policy permits zero mint and empty metadata; it still consumes a deposit nonce.
    await expect(mint(core, [alice], [0], [''], [''])).emit(core, 'DepositMinted').withArgs(alice.address, 0, '', '', 1);
    expect(await core.totalSupply()).eq(0); expect(await core.mintDepositNonce()).eq(1);
  });
  it('should document repeated source tx IDs minting again without on-chain replay protection', async function () {
    const { core, alice } = await loadFixture(deploy);
    // Custodian MUST deduplicate source deposits off-chain, across batches and recipients.
    await mint(core, [alice, alice], [10, 10], ['w', 'w'], ['same', 'same']);
    await mint(core, [alice], [10], ['w'], ['same']);
    expect(await core.balanceOf(alice)).eq(30); expect(await core.totalSupply()).eq(30); expect(await core.mintDepositNonce()).eq(3);
  });
});
