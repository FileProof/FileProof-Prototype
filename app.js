// Require dependencies
const deployed =  require("./config.js");
const contract = require('truffle-contract');
const fileProofArtifacts = require('./build/contracts/FileProofHashStore.json');
const Web3 = require('web3');
const fs = require('fs');

  // header format
let header = {
  container_version: '0.1.0',
  header_id: '',
  category: '',
  issuer_name: '',
  validator_name: '',
  issuer_uuid: '',
  validator_uuid: '',
  validator_legitimation_header_id: '',
  recipient_name: '',
  recipient_uuid: '',
  previous_header_id: '',
  validation_counter: '',
  next_header_id: '',
  timestamp: '',
  block_number: '',
  data_address: '',
  validation_expiry: '',
  data_hash: '',
  nonce: ''
}

// Bootstrap web3
if (typeof web3 !== 'undefined') {
  web3 = new Web3(web3.currentProvider);
} else {
  // set the provider we want from Web3.providers
  web3 = new Web3(new Web3.providers.HttpProvider("http://localhost:8545"));
  web3.eth.defaultAccount = web3.eth.accounts[1]
  web3.personal.unlockAccount(web3.eth.defaultAccount)
}

// Check balance
balance = web3.eth.getBalance(web3.eth.defaultAccount);
console.log('Balance:', web3.fromWei(balance.toNumber(), "ether"))

// Then create an instance of FileProof Contract
const FileProofContract = contract(fileProofArtifacts)
FileProofContract.setProvider(web3.currentProvider)
let fileproof = FileProofContract.at(deployed.address)

// setup firebase
const firebase = require("firebase");
var config = {
  apiKey: "",
  authDomain: "",
  databaseURL: "",
  projectId: "",
  messagingSenderId: ""
};

// Get a reference to firestore service
firebase.initializeApp(config);
const db = firebase.firestore();
const settings = {timestampsInSnapshots: true};
db.settings(settings);

// Read the file provided on command line
let file = process.argv[2];
if (file) {
  console.log('++++++++++++++++++++++++')
  console.log('Filename:', file)
  try {
    binaryData = fs.readFileSync(file);
  } catch (err) {
    console.log('ERROR: No such file:', file)
    process.exit(1)
  }
} else {
  console.log('ERROR: Please provide filename as an argument.')
  process.exit(1)
}

// Encode file contents to base64 format
let data = binaryData.toString('base64');

// Test crypto support is present
let crypto, dataHash, nonce, headerHash;
try {
  crypto = require('crypto');
} catch (err) {
  console.log('crypto support is disabled!');
  process.exit(1)
}

// Compute the hash of data
dataHash = crypto.createHash('sha256').update(data).digest('hex');

// Check for validation v/s verification
// 3rd command line argument is the claimed FP header hash of input file
let claimedHeaderHash = process.argv[3];

if (claimedHeaderHash) {
  // This is a verification request
  verifyDocument(dataHash, claimedHeaderHash)
} else {
  // This is a validation request
  validateDocument(dataHash)
}

// *************** functions *************** //

function verifyDocument(dataHash, claimedHeaderHash) {
  // check if `claimedHeaderHash` exists in the database
  db.collection('headers').doc(claimedHeaderHash).get()
    .then(doc => {
      // does the claimed header hash exist in the database?
      if (!doc.exists) {
        console.log('FAIL: No header found!');
        process.exit(0)
      } else {
        // does the hash of the input file match with that stored in the header
        console.log('PASS: Header found in database!')
        var header = doc.data()
        if (dataHash === header.data_hash) {
          console.log('PASS: File hash is valid and verified by header.')
          console.log('File hash:', header.data_hash)

          // verify header hash on blockchain
          fileproof.does_headerHash_exist('0x' + claimedHeaderHash)
          .then(function(result) {
            if (result) {
              console.log('PASS: Header hash from block:', claimedHeaderHash)
              console.log('Block number:', header.block_number)
              console.log('Timestamp:', header.timestamp)    
              process.exit(0)
            } else {
              console.log('FAIL: Header hash does not exist on blockchain!')
            }
          })
        } else {
          console.log('FAIL: Invalid file hash!')
          console.log('Hash of provided file:', dataHash)
          console.log('Hash from stored header:', header.data_hash)
          process.exit(0)
        }
      }
    })
    .catch(err => {
      console.log('Error getting document', err);
      process.exit(1)
    });
}

function validateDocument(dataHash) {
  // Prepare header, add nonce, expiry etc
  header.data_hash = dataHash;
  var bytes = crypto.randomBytes(32);
  nonce = bytes.toString('hex');
  header.nonce = nonce
  var d = new Date();
  header.validation_expiry = new Date(d.getFullYear() + 1, d.getMonth()).toISOString()

  // bencode the header data and calculate header hash
  let bencode = require('bencode');
  let headerBuffer = bencode.encode(header)
  headerHash = crypto.createHash('sha256').update(headerBuffer, 'binary').digest('hex');

  // Prepare transaction
  console.log('++++++++++++++++++++++++')
  console.log('SHA-256 Hash of file contents:\n', dataHash)
  console.log('++++++++++++++++++++++++')
  console.log('Header:')
  console.log(header)
  console.log('++++++++++++++++++++++++')
  console.log('Hash of Header:\n', headerHash)
  console.log('++++++++++++++++++++++++')

  // Send transaction
  console.log('Sending transaction ...\n++++++++++++++++++++++++')
  fileproof.saveHeaderHash('0x' + headerHash, {gas:3000000})
    .then((result) => {
      console.log('++++++++++++++++++\n... Success ...')
      console.log('transactionHash:',result.receipt.transactionHash)
      console.log('status:',result.receipt.status)
      console.log('++++++++++++++++++')
    })
    .catch((err) => {
      console.log(err);
    });

  // Watch for events, parse events and display
  let hashCreated = fileproof.FileProofHashCreated()
  hashCreated.watch(function(error, result){
    if (!error) {
      console.log('Received FileProof Hash storage event');
      console.log('++++++++++++++++++++++++')
      console.log('Validator:', result.args.validator)
      console.log('Header Hash:', result.args.headerHash.replace('0x', ''))
      header.block_number = result.blockNumber
      console.log('Block number:', header.block_number)
      header.timestamp = new Date(result.args.creation_timestamp.toNumber() * 1000).toISOString()
      console.log('Timestamp:', header.timestamp)
      console.log('Headers stored count:', result.args.headers_count.toNumber())
      console.log('++++++++++++++++++++++++')
      // Display new header
      console.log('New Header with timestamp and blockNumber:')
      console.log(header)
      // Stop watching for events
      hashCreated.stopWatching()

      // write to database
      writeToDatabase(headerHash, header)
    } else {
      console.log(error)
    }
  });  
}

function writeToDatabase(headerHash, header) {
  // insert data
  db.collection('headers')
    .doc(headerHash).set(header)
    .then(function() {
      console.log('+++++++++++++++\nWrote header to database.\n++++++++++++++++')
      console.log("Successfully validated!")
      process.exit(0)
    })
}

// Deconstruct the header and re-compute the hash
function deconstruct (header, headerHash) {
  newHeader = header;
  newHeader.timestamp = ''
  newHeader.block_number = ''
  let newHeaderBuffer = bencode.encode(newHeader)
  newHeaderHash = crypto.createHash('sha256').update(newHeaderBuffer, 'binary').digest('hex');
  console.log('\nDeconstructed header hash:', newHeaderHash)
}
