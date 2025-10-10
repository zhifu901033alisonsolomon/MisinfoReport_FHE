
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, euint64 } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

/// @notice Lightweight FHE-enabled reporting contract
contract MisinfoReportFHE is SepoliaConfig {
    // Internal identifier counter
    uint256 public reportCounter;

    // Compact encrypted record
    struct EncryptedRecord {
        uint256 id;
        euint32 titleEnc;
        euint32 bodyEnc;
        euint32 categoryEnc;
        uint256 ts;
    }

    // Revealed plaintext container
    struct PlainRecord {
        string title;
        string body;
        string category;
        bool revealed;
    }

    // Storage mappings
    mapping(uint256 => EncryptedRecord) public encryptedRecords;
    mapping(uint256 => PlainRecord) public plainRecords;
    mapping(bytes32 => euint32) private encryptedCounts;
    string[] private knownCategories;

    // Request association
    mapping(uint256 => uint256) private decryptRequestMap;

    // Events
    event Submitted(uint256 indexed id, uint256 when);
    event DecryptionRequested(uint256 indexed id, uint256 requestId);
    event Decrypted(uint256 indexed id);

    // Access control placeholder
    address public operator;

    // Constructor sets operator
    constructor() {
        operator = msg.sender;
    }

    // Modifier for operator-only actions
    modifier onlyOperator() {
        require(msg.sender == operator, "unauthorized");
        _;
    }

    // Modifier placeholder for reporter authorization checks
    modifier reporterGuard(uint256 /*id*/) {
        _;
    }

    // Submit an encrypted record
    function submitEncrypted(
        euint32 titleEnc,
        euint32 bodyEnc,
        euint32 categoryEnc
    ) public {
        reportCounter += 1;
        uint256 rid = reportCounter;

        encryptedRecords[rid] = EncryptedRecord({
            id: rid,
            titleEnc: titleEnc,
            bodyEnc: bodyEnc,
            categoryEnc: categoryEnc,
            ts: block.timestamp
        });

        plainRecords[rid] = PlainRecord({
            title: "",
            body: "",
            category: "",
            revealed: false
        });

        emit Submitted(rid, block.timestamp);
    }

    // Request decryption for a single report
    function requestDecryption(uint256 reportId) public reporterGuard(reportId) {
        PlainRecord storage p = plainRecords[reportId];
        require(!p.revealed, "already revealed");

        EncryptedRecord storage e = encryptedRecords[reportId];
        bytes32[] memory c = new bytes32[](3);
        c[0] = FHE.toBytes32(e.titleEnc);
        c[1] = FHE.toBytes32(e.bodyEnc);
        c[2] = FHE.toBytes32(e.categoryEnc);

        uint256 req = FHE.requestDecryption(c, this.handleDecryption.selector);
        decryptRequestMap[req] = reportId;

        emit DecryptionRequested(reportId, req);
    }

    // Callback invoked by FHE runtime after decryption
    function handleDecryption(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 reportId = decryptRequestMap[requestId];
        require(reportId != 0, "invalid request");

        PlainRecord storage p = plainRecords[reportId];
        require(!p.revealed, "already revealed");

        // Verify cryptographic proof
        FHE.checkSignatures(requestId, cleartexts, proof);

        string[] memory parts = abi.decode(cleartexts, (string[]));
        // Defensive assignment
        if (parts.length >= 3) {
            p.title = parts[0];
            p.body = parts[1];
            p.category = parts[2];
            p.revealed = true;
        } else {
            revert("decryption decode error");
        }

        // Maintain category bookkeeping (encrypted)
        bytes32 catHash = keccak256(abi.encodePacked(p.category));
        if (!FHE.isInitialized(encryptedCounts[catHash])) {
            encryptedCounts[catHash] = FHE.asEuint32(0);
            knownCategories.push(p.category);
        }
        encryptedCounts[catHash] = FHE.add(encryptedCounts[catHash], FHE.asEuint32(1));

        emit Decrypted(reportId);
    }

    // Query decrypted plain record
    function viewPlain(uint256 reportId) public view returns (
        string memory title,
        string memory body,
        string memory category,
        bool revealed
    ) {
        PlainRecord storage p = plainRecords[reportId];
        return (p.title, p.body, p.category, p.revealed);
    }

    // Get encrypted count for a category
    function getEncryptedCount(string memory category) public view returns (euint32) {
        bytes32 h = keccak256(abi.encodePacked(category));
        return encryptedCounts[h];
    }

    // Request decryption of an encrypted count
    function requestCountDecryption(string memory category) public {
        bytes32 h = keccak256(abi.encodePacked(category));
        euint32 c = encryptedCounts[h];
        require(FHE.isInitialized(c), "category unknown");

        bytes32[] memory payload = new bytes32[](1);
        payload[0] = FHE.toBytes32(c);
        uint256 req = FHE.requestDecryption(payload, this.handleCountDecryption.selector);

        // store mapping using pseudo-id scheme
        decryptRequestMap[req] = uint256(h);
    }

    // Callback for decrypted counts
    function handleCountDecryption(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 mapped = decryptRequestMap[requestId];
        require(mapped != 0, "invalid mapping");

        FHE.checkSignatures(requestId, cleartexts, proof);

        uint32 count = abi.decode(cleartexts, (uint32));
        // Silent consumption of decrypted count - extend as needed
        mapped; count;
    }

    // Batch submission helper
    function submitBatch(
        euint32[] memory titles,
        euint32[] memory bodies,
        euint32[] memory categories
    ) public {
        require(titles.length == bodies.length && bodies.length == categories.length, "length mismatch");
        for (uint256 i = 0; i < titles.length; i++) {
            submitEncrypted(titles[i], bodies[i], categories[i]);
        }
    }

    // Operator can rotate operator address
    function setOperator(address newOp) public onlyOperator {
        require(newOp != address(0), "zero address");
        operator = newOp;
    }

    // Expose known categories
    function listCategories() public view returns (string[] memory) {
        return knownCategories;
    }

    // Utility: recover string by category hash
    function categoryFromHash(uint256 hashVal) public view returns (string memory) {
        for (uint256 i = 0; i < knownCategories.length; i++) {
            if (uint256(keccak256(abi.encodePacked(knownCategories[i]))) == hashVal) {
                return knownCategories[i];
            }
        }
        revert("not found");
    }

    // Internal helper: bytes32 to uint
    function _b32toUint(bytes32 b) internal pure returns (uint256) {
        return uint256(b);
    }

    // Fallbacks
    receive() external payable { }
    fallback() external payable { }
}
