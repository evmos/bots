## TX bot

A spam bot that continuously sends transactions to EVM endpoint.

### Overview

The bot runs as follows:

1.  Check orchestrator balance. Exit if balance below threshold.
2.  Deploy gas consumer contract.
3.  Create worker accounts and fund them.
4.  Run workers of different types. Find more details about these on the next section.
5.  On insufficient funds, refund workers.

#### Worker types

This repository supports 5 worker types:

- **Gas consumer**: keeps calling a gas consumer contract's `go` method which is a loop that exits when gas used reaches a threshold.
- **Bank worker**: continuously sends funds to another account using the `MsgSend` message from the `bank` module.
- **ERC-20 converter**: keeps sending `MsgConvertERC20` messages to convert ERC-20 tokens to IBC coins.
  The corresponding token pair is registered during the bot initialization.
- **ETH sender**: continuously sends funds to another account using the [`ethers`](https://docs.ethers.org/v6/) library.
- **Delegator**: stakes (delegates) part of its balance to a validator available on the network.

Workers are spanned on a round-robin fashion.

### Features

- Create workers (accounts) to prevent nonce issues.
- Deploy smart contract for workers to call.
- Manage nonce of workers to allow as many successful txs as possible.
- Fund and refund workers when they encounter insufficient fund error.
- Expose the following metrics:
  - `num_failed_tx`
  - `num_success_tx`
  - `fee_success_tx`
- Check orchestrator balance and exit if balance is below threshold.

### Environment variables

| variable               | description                                                        | required | default                 |
| ---------------------- | ------------------------------------------------------------------ | -------- | ----------------------- |
| ORCH_PRIV_KEY          | orchestrator private key used to fund worker accounts              | yes      | N/A                     |
| RPC_URL                | evm rpc url to send tx                                             | no       | `http://localhost:8545` |
| API_URL                | evm API server url to send queries and txs                         | no       | `http://localhost:1317` |
| CHAIN_ID               | unique identifier of the chain that the bot will connect to        | no       | `evmos_9000-1`          |
| ORCH_MIN_FUNDS_BASE    | minimum balance that orchestrator must have. Exit otherwise        | no       | `10000000000000000000`  |
| NUMBER_OF_WORKERS      | number of workers (accounts) that will send txs                    | no       | 10                      |
| FUNDS_PER_ACCOUNT_BASE | fund amount for workers used initially and on insufficient balance | no       | `1000000000000000000`   |
| WAIT_FOR_TX_MINE       | flag to determine whether to wait for tx to mine or not            | no       | false                   |
| GAS_CONSUME_PER_TX     | how much gas to use in gas-consumer worker                         | no       | `100000`                |
| LOG_LEVEL              | application logging level                                          | no       | info                    |
| SERVER_PORT            | port to run server on. Used to expose metrics                      | no       | 8080                    |

### Setup

Before running the bot make sure that the api is enabled.  
On the `app.toml` file set the following configuration:

```shell
[api]

# Enable defines if the API server should be enabled.
enable = true

# EnableUnsafeCORS defines if CORS should be enabled (unsafe - use it at your own risk).
enabled-unsafe-cors = true
```

Also, it is important to increase the number of conections allowed by grpc.
To achieve this, make sure to edit the `config.toml` file with the following:

```shell
# Maximum number of unique queries a given client can /subscribe to
# If you're using GRPC (or Local RPC client) and /broadcast_tx_commit, set to
# the estimated # maximum number of broadcast_tx_commit calls per block.
max_subscriptions_per_client = 500
```

### Install dependencies

Use `npm` to install all the corresponding dependencies:

```bash
npm install
```

### Build

Use `npm` to compile the code:

```bash
npm run build
```

The compiled files will be located inside the `dist` directory.

### Run natively

```bash
npm install
export CHAIN_ID=evmos_9000-1
export CHAIN_ID_NUMBER=9000
export RPC_URL=http://evm-rpc-url:8545
export API_URL=http://evm-rpc-url:1317
export ORCH_PRIV_KEY=YOUR_FUNDER_ACCOUNT_PRIV_KEY
npx ts-node src/index.ts
```

Alternatively, you can build the project and run it using this command:

```bash
node ./dist/index.js
```

### Run using docker

To run the bot inside a docker container, use the following commands:

```bash
docker build -t tx-bot-dev -f Dockerfile.dev .
docker run -it --init --rm --network=host -e CHAIN_ID_NUMBER=9000 -e CHAIN_ID=evmos_9000-1 -e API_URL=http://evm-rpc-url:1317 -e RPC_URL=http://localhost:8545 -e ORCH_PRIV_KEY=YOUR_FUNDER_ACCOUNT_PRIV_KEY tx-bot-dev
```
