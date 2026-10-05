import "dotenv/config";

import {defineConfig} from "hardhat/config";
import hardhatToolboxMochaEthers
    from "@nomicfoundation/hardhat-toolbox-mocha-ethers";

const MAINNET_PRIVATE_KEY = process.env.MAINNET_PRIVATE_KEY;
const TESTNET4_PRIVATE_KEY = process.env.TESTNET4_PRIVATE_KEY;

const BSC_TESTNET4_RPC_URL =
    process.env.BSC_TESTNET4_RPC_URL ||
    "https://bsc-testnet-dataseed.bnbchain.org";

const BSC_MAINNET_RPC_URL =
    process.env.BSC_MAINNET_RPC_URL ||
    "https://bsc-dataseed.bnbchain.org";

const BSCSCAN_API_KEY =
    process.env.BSCSCAN_API_KEY || "";

export default defineConfig({
    plugins: [
        hardhatToolboxMochaEthers
    ],

    solidity: {
        version: "0.8.37",
        settings: {
            optimizer: {
                enabled: true,
                runs: 200
            },
            viaIR: true
        }
    },

    networks: {
        bscTestnet: {
            type: "http",
            url: BSC_TESTNET4_RPC_URL,
            chainId: 97,
            accounts: TESTNET4_PRIVATE_KEY
                ? [TESTNET4_PRIVATE_KEY]
                : []
        },

        bsc: {
            type: "http",
            url: BSC_MAINNET_RPC_URL,
            chainId: 56,
            accounts: MAINNET_PRIVATE_KEY
                ? [MAINNET_PRIVATE_KEY]
                : []
        }
    },

    verify: {
        blockscout: {
            enabled: false
        },
        etherscan: {
            apiKey: BSCSCAN_API_KEY
        }
    }
});
