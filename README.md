# dex-smart-contract

## Compile
```bash
npx hardhat clean
npx hardhat compile
```

## BSC Mainnet
### Deploy
```bash
npx hardhat run scripts/deploy.js --network bsc
```

### Verify ATCOINCore implementation
```bash
npx hardhat verify \
--network bsc \
--contract contracts/main/ATCOINCore.sol:ATCOINCore \
0xIMPLEMENTATION_ADDRESS
```

### Verify ATCOINProxy
```bash
npx hardhat verify \
--network bsc \
--contract contracts/ATCOINProxy.sol:ATCOINProxy \
0xPROXY_ADDRESS \
0xIMPLEMENTATION_ADDRESS \
0xINITIAL_OWNER
```

### Verify proxy relation on BscScan
https://bscscan.com/address/0xPROXY_ADDRESS

## BSC Testnet4
### Deploy
```bash
npx hardhat run scripts/deploy.js --network bscTestnet
```

### Verify ATCOINCore implementation
```bash
npx hardhat verify \
--network bscTestnet \
--contract contracts/testnet4/ATCOINCore.sol:ATCOINCore \
0xIMPLEMENTATION_ADDRESS
```

### Verify ATCOINProxy
```bash
npx hardhat verify \
--network bscTestnet \
--contract contracts/ATCOINProxy.sol:ATCOINProxy \
0xPROXY_ADDRESS \
0xIMPLEMENTATION_ADDRESS \
0xINITIAL_OWNER
```

### Verify proxy relation on BscScan
https://testnet.bscscan.com/address/0xPROXY_ADDRESS