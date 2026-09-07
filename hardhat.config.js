require("@nomicfoundation/hardhat-toolbox");
require("@openzeppelin/hardhat-upgrades");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  paths: { cache: ".hardhat/cache", artifacts: ".hardhat/artifacts" },
  solidity: {
    version: "0.8.36",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      },
      viaIR: true
    }
  }
};