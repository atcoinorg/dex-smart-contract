import { network } from "hardhat";

const connection = await network.create();
const { ethers, networkName } = connection;

const CORE_BY_NETWORK = {
    bscTestnet: "contracts/testnet4/ATCOINCore.sol:ATCOINCore",
    bsc: "contracts/main/ATCOINCore.sol:ATCOINCore",
};

const ENV_BY_NETWORK = {
    bsc: ["BSC_MAINNET_RPC_URL", "MAINNET_PRIVATE_KEY"],
    bscTestnet: ["BSC_TESTNET4_RPC_URL", "TESTNET4_PRIVATE_KEY"],
};

const PROXY_CONTRACT =
    "contracts/ATCOINProxy.sol:ATCOINProxy";

async function main() {
    console.log("Network:", networkName);

    const CORE_CONTRACT = CORE_BY_NETWORK[networkName];

    if (!CORE_CONTRACT) {
        throw new Error(
            `Unsupported deployment network: ${networkName}. ` +
            `Allowed networks: ${Object.keys(CORE_BY_NETWORK).join(", ")}`
        );
    }

    const missingVariables = ENV_BY_NETWORK[networkName].filter(
        (name) => !process.env[name]?.trim()
    );

    if (missingVariables.length > 0) {
        throw new Error(
            `Missing environment variables for ${networkName}: ` +
            missingVariables.join(", ")
        );
    }

    console.log("ATCOINCore source:", CORE_CONTRACT);
    console.log("Proxy source:", PROXY_CONTRACT);

    const [deployer] = await ethers.getSigners();

    if (!deployer) {
        throw new Error(`No deployment account configured for ${networkName}`);
    }

    console.log("\nDeployer:", deployer.address);

    const balance =
        await ethers.provider.getBalance(deployer.address);

    console.log(
        "Balance:",
        ethers.formatEther(balance),
        "BNB"
    );

    // ==========================================
    // 1. Deploy ATCOINCore implementation
    // ==========================================

    console.log("\nDeploying ATCOINCore...");

    const Core = await ethers.getContractFactory(
        CORE_CONTRACT
    );

    const core = await Core.deploy();

    await core.waitForDeployment();

    const implementationAddress =
        await core.getAddress();

    console.log(
        "ATCOINCore implementation:",
        implementationAddress
    );

    // ==========================================
    // 2. Initial owner
    // ==========================================

    const initialOwner = deployer.address;

    console.log(
        "Initial owner:",
        initialOwner
    );

    // ==========================================
    // 3. Deploy proxy
    // ==========================================

    console.log("\nDeploying ATCOINProxy...");

    const Proxy = await ethers.getContractFactory(
        PROXY_CONTRACT
    );

    const proxy = await Proxy.deploy(
        implementationAddress,
        initialOwner
    );

    // Get proxy deployment transaction
    const proxyDeploymentTx =
        proxy.deploymentTransaction();

    if (!proxyDeploymentTx) {
        throw new Error(
            "Unable to get ATCOINProxy deployment transaction"
        );
    }

    // Wait for proxy deployment transaction
    const proxyReceipt =
        await proxyDeploymentTx.wait();

    if (!proxyReceipt) {
        throw new Error(
            "Unable to get ATCOINProxy deployment receipt"
        );
    }

    const proxyBlockNumber =
        proxyReceipt.blockNumber;

    await proxy.waitForDeployment();

    const proxyAddress =
        await proxy.getAddress();

    console.log(
        "ATCOINProxy:",
        proxyAddress
    );

    console.log(
        "ATCOINProxy block:",
        proxyBlockNumber
    );

    // ==========================================
    // 4. Read implementation ABI through proxy
    // ==========================================

    const token = await ethers.getContractAt(
        CORE_CONTRACT,
        proxyAddress
    );

    console.log("\nChecking proxy initialization...");

    console.log(
        "name:",
        await token.name()
    );

    console.log(
        "symbol:",
        await token.symbol()
    );

    console.log(
        "decimals:",
        await token.decimals()
    );

    console.log(
        "owner:",
        await token.owner()
    );

    console.log("\n================================");
    console.log("DEPLOYMENT COMPLETE");
    console.log("================================");

    console.log(
        "NETWORK=" +
        networkName
    );

    console.log(
        "CORE_CONTRACT=" +
        CORE_CONTRACT
    );

    console.log(
        "IMPLEMENTATION_ADDRESS=" +
        implementationAddress
    );

    console.log(
        "PROXY_ADDRESS=" +
        proxyAddress
    );

    console.log(
        "PROXY_BLOCK_NUMBER=" +
        proxyBlockNumber
    );

    console.log(
        "INITIAL_OWNER=" +
        initialOwner
    );
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
