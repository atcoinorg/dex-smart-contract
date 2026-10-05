import { network } from 'hardhat';
import { expect } from 'chai';

const { ethers, networkHelpers } = await network.create();
const loadFixture = networkHelpers.loadFixture.bind(networkHelpers);
const CORE_CONTRACT = 'contracts/testnet4/ATCOINCore.sol:ATCOINCore';
async function deploy() {
  const [owner, alice, bob, mallory, admin, minter, pauser, stranger] = await ethers.getSigners();
  const implementation = await ethers.deployContract(CORE_CONTRACT);
  const proxy = await ethers.deployContract('ATCOINProxy', [implementation.target, owner.address]);
  const core = await ethers.getContractAt(CORE_CONTRACT, proxy.target);
  const roles = { Admin: await core.ADMIN_ROLE(), Minter: await core.MINTER_ROLE(), Pauser: await core.PAUSER_ROLE() };
  return { core, proxy, implementation, owner, alice, bob, mallory, admin, minter, pauser, stranger, roles, cap: await core.MAX_ATCOIN_UNITS(), min: await core.MIN_WITHDRAW(), max: Number(await core.MAX_BATCH()) };
}
function mint(core, users, amounts, wallets = users.map((_, i) => `wallet-${i}`), ids = users.map((_, i) => `tx-${i}`)) {
  return core.batchMintDepositEVMATCOINHandler(users.map(u => u.address ?? u), amounts, wallets, ids);
}
function complete(core, users, amounts, nonces, ids = users.map((_, i) => `out-${i}`)) {
  return core.batchWithdrawCompleted(users.map(u => u.address ?? u), amounts, ids, nonces);
}
function events(core, receipt, name) {
  return receipt.logs.filter(l => l.address.toLowerCase() === core.target.toLowerCase()).map(l => { try { return core.interface.parseLog(l); } catch { return null; } }).filter(l => l?.name === name);
}
async function snapshot(core, users) {
  return { supply: await core.totalSupply(), mint: await core.mintDepositNonce(), burn: await core.burnNonce(), balances: await Promise.all(users.map(u => core.balanceOf(u.address ?? u))) };
}
async function unauthorized(promise, core, user, role) {
  await expect(promise).to.be.revertedWithCustomError(core, 'AccessControlUnauthorizedAccount').withArgs(user.address, role);
}
export { ethers, expect, loadFixture, deploy, mint, complete, events, snapshot, unauthorized };
