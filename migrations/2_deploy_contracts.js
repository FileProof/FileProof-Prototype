const HashStorage = artifacts.require('FileProofHashStore');

module.exports = function(deployer, network, accounts) {
  const DEFAULT_GAS_LIMIT = 5000000;

  deployer
    // Deploy the HashStorage contract
    .deploy(HashStorage, { gas: DEFAULT_GAS_LIMIT })
};
