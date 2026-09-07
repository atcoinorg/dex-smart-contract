// SPDX-License-Identifier: MIT
pragma solidity ^0.8.36;

import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/**
 * @title ATCOINProxy
 * @author W-DEVELOP Group developing.w@gmail.com
 * @dev https://github.com/atcoinorg/dex-smart-contract Managing logic via the ERC1967Proxy with UUPSUpgradeable implementation.
 * @notice Proxy for ATCOINCore (EVM ATCOIN).
 */
contract ATCOINProxy is ERC1967Proxy {
    constructor(address logicContract, address initialOwner)
        ERC1967Proxy(
            logicContract,
            abi.encodeWithSelector(
                bytes4(keccak256("initialize(address)")),
                initialOwner
            )
        )
    {}
}
