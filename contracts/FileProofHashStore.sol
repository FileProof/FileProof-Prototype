pragma solidity ^0.4.21;

import "./lib/SafeMath.sol";

/**
 * FileProof hash storage smart contract.
 */

contract FileProofHashStore {
    using SafeMath for uint;
    using SafeMath for uint256;

    address public owner = 0x0;
    // A counter for number of hashes stored
    uint headers_count;
    // A boolean mapping to determine if a particular hash was stored
    mapping (bytes32 => bool) public Hashes;

    // ========== CONSTRUCTOR =========
    constructor() public {
        // The account that deploys the contract will be the contract owner.
        owner = msg.sender;
        headers_count = 0;
    }

    // ========== EVENTS ==========
    event FileProofHashCreated(address indexed validator, bytes32 headerHash, uint creation_timestamp, uint headers_count);

    // ========== CONTRACT FUNCTIONS ==========

    // Check if the given header hash exists.
    function does_headerHash_exist(bytes32 header_hash) external view returns (bool) {
        return Hashes[header_hash];
    }

    // Save the hash of a header onto blockchain
    function saveHeaderHash(bytes32 headerHash) external {
        // Use current block timestamp as hash creation timestamp
        uint creation_timestamp = block.timestamp;

        // Set state to true
        Hashes[headerHash] = true;

        // Increment count
        headers_count = headers_count.add(1);

        // Emit event to indicate storage of the hash
        emit FileProofHashCreated(msg.sender, headerHash, creation_timestamp, headers_count);
    }
}