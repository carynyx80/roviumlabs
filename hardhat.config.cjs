/** Hardhat is used for the local development chain and to compile/test contracts. */
module.exports = {
  solidity: {
    version: "0.8.28",
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "paris" },
  },
  paths: { sources: "./contracts", artifacts: "./.hardhat/artifacts", cache: "./.hardhat/cache", tests: "./tests/contracts" },
  networks: {
    hardhat: { chainId: 31337 },
  },
};
