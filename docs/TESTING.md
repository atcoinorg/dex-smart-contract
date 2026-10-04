# ATCOIN: security / QA test suite

## Запуск

```sh
npm ci
npm run compile
npm test
npm run test:gas
npm run test:coverage
```

Используется существующий Hardhat 2 + ethers 6 + chai + network helpers (`loadFixture`). OpenZeppelin hardhat-upgrades закреплён на 3.9.1, совместимой с Hardhat 2. Lockfile фиксирует установленные версии; для воспроизводимости используйте `npm ci`. CI выполняет compile и весь suite на Node 22.

Compiler: Solidity 0.8.37, optimizer 200, viaIR, EVM target paris. OpenZeppelin contracts и contracts-upgradeable: 5.6.1. Hardhat 2.29.1 предупреждает о неполной поддержке диагностик Solidity 0.8.37; compile и исполнение тестов проверяются отдельно. Build-каталоги перенесены в `.hardhat/cache` и `.hardhat/artifacts`, поскольку исходные `cache`/`artifacts` в предоставленной рабочей копии принадлежат root. Production Solidity не изменялся. Уже существовавшее изменение комментария ATCOINProxy сохранено.

## Структура

| Файл | Проверки |
| --- | --- |
| `test/deployment.test.js` | Initializer, metadata, initial roles, proxy isolation, UUID |
| `test/mint.test.js` | Cap, batch limits, events, nonce, atomicity, trusted deposits |
| `test/withdrawal.test.js` | Burn boundaries, completion filtering, duplicates, trusted report |
| `test/pause.test.js` | Три независимых pause-механизма и events |
| `test/blacklist.test.js` | Sender/recipient/spender, rollback allowance, infinite allowance |
| `test/roles.test.js` | Helpers, public AccessControl API, Ownable separation |
| `test/emergency.test.js` | Recovery, SafeERC20, malicious callback, guard recovery |
| `test/erc20.test.js` | Стандартные ERC20 events, balances, errors, ERC165 |
| `test/upgrade.test.js` | UUPS authority, invalid targets, validation, storage preservation |
| `test/invariants.test.js` | Три фиксированных PRNG seed, модель balances/supply, near-cap cycles |
| `test/gas.test.js` | 1/10/100/200 mint и 1/200 реальных completion |
| `contracts/test/TestMocks.sol` | V2 без новых storage variables, ERC20 mocks, malicious token |

Mocks предназначены только для тестирования и не должны входить в production deployment. ReentrantToken специально становится owner proxy, чтобы same-function callback достигал `nonReentrant`, а не останавливался на `onlyOwner`. Проверяется и cross-function callback в withdrawalRequest. После каждого attack проверяются rollback и последующие успешные recovery.

Randomized suite выполняет 300 операций с моделью всех используемых держателей и ещё 25 циклов burn/mint у cap. В каждой точке проверяются supply, balances, оба nonce и cap; equality суммы balances с supply сильнее требуемого <=. Seed фиксированы для воспроизводимости. Это ограниченное model-based тестирование, а не доказательство для всех возможных последовательностей.

## Storage gate

`npm test` вызывает `upgrades.validateUpgrade(ATCOINCore, ATCOINCoreV2)`. Несовместимый layout приводит к ошибке suite. Дополнительный negative-control изменяет slot mintDepositNonce в копии compiler metadata и проверяет, что валидатор отклоняет изменение. Исходники при этом не модифицируются.

Единственное разрешение для production-кода — `unsafeAllow: ['constructor']`: constructor содержит только `_disableInitializers()`. V2 аннотирован `missing-initializer`, поскольку наследует существующий initializer без нового состояния. `unsafeSkipStorageCheck` не используется. Механизм соответствует [документации OpenZeppelin validation options](https://docs.openzeppelin.com/upgrades-plugins/api-hardhat-upgrades).

До/после upgrade сравниваются metadata, constants, supply, balances, все пары allowances выбранных адресов, blacklist, completion mapping, nonce, три pause-флага, owner, роли и их admin roles. Также сравниваются локальные storage slots 0–5, включая private reentrancy status. После upgrade проверяется продолжение mint, burn, completion и transfer.

В проекте нет идентифицированного ранее deployed implementation, адреса proxy или его build metadata. Поэтому проверена совместимость **текущий исходник → тестовый V2**, но не **исторический deployment → текущий исходник**. Наследующий V2 не является историческим baseline. Перед реальным обновлением нужно передать валидатору фактический предыдущий implementation/build, а также сохранить этот baseline в release-процессе. On-chain UUPS UUID проверяет интерфейс, но не storage layout и не безопасность нового кода; DEFAULT_ADMIN обязан выполнять off-chain validation.

## Зафиксированные trust assumptions и риски

1. **Source deposit replay:** одинаковый atcoinTxId может повторяться внутри batch и между batch. Каждый вызов снова mint-ит токены. Custodian должен обеспечивать durable/idempotent обработку депозитов, finality и deduplication. Нарушение этого условия допускает необеспеченную эмиссию до cap; это документированное поведение, не скрытая смена expectation.
2. **Trusted completion:** проверяются лишь существование nonce и отсутствие completion. ADMIN может указать другого пользователя, нулевую/неверную сумму и пустой tx ID. Event не является on-chain доказательством выплаты. Ошибочный report необратимо занимает nonce completion.
3. **Пустые bridge-поля:** zero mint и пустые metadata разрешены; zero mint увеличивает nonce. Пустой withdrawal destination разрешён и сжигает реальные токены. Backend/UI должны предотвращать неисполняемые заявки.
4. **Две authority-системы:** transferOwnership не переносит DEFAULT_ADMIN или operational roles. Старый DEFAULT_ADMIN сохраняет upgrade authority; новый owner получает только recovery authority. Потеря/renounce последнего DEFAULT_ADMIN лишает возможности управлять ролями и обновлениями.
5. **Public AccessControl API:** inherited grantRole/revokeRole/renounceRole доступны. grantRole разрешает zero address и повторный grant без helper error; off-chain мониторинг должен учитывать стандартные RoleGranted/RoleRevoked, а не только custom events. revokePauserRole(0) также разрешён текущим кодом.
6. **Pause policy:** global pause останавливает только transfers. Для полной остановки token operations нужны и mintPaused, и burnPaused. Blacklist не отменяет approve и не стирает allowance: после unblock старое разрешение снова работает. Spender bypass через transferFrom в проверенных сценариях не воспроизводится.
7. **Privileged upgrade:** DEFAULT_ADMIN может установить storage-совместимый или несовместимый код с правильным UUID. Multisig/timelock, проверка implementation и release-процесс находятся вне этого suite.
8. **Gas:** длина строк не ограничена контрактом. Измерение с 64-byte metadata не является верхней границей gas для любых входов. Целевая сеть и её block/per-transaction limits не заданы.
9. **Toolchain:** npm audit сообщает advisories в dev dependency tree; production Solidity findings и npm advisories нельзя смешивать. Major migration на Hardhat 3 автоматически не выполнялась.

Недостижимая при корректном supply ветка `withdrawAmount > MAX_ATCOIN_UNITS` находится после проверки balance: при invariant supply <= cap баланс не может быть выше cap. Не используется искусственная порча storage для достижения этой ветки. Проверки диапазона uint64 дополнительно ограничены ABI.

## Gas baseline

Обычный `npm test`, без coverage instrumentation; локальный block gas limit 60 000 000. Mint использует отдельный новый balance slot для каждого адреса и 64-byte wallet/tx ID; completion — существующие уникальные burn nonce и 64-byte tx ID.

| Операция | Batch | Gas used |
| --- | ---: | ---: |
| Mint | 1 | 117 519 |
| Mint | 10 | 438 686 |
| Mint | 100 | 3 651 587 |
| Mint | 200 | 7 225 169 |
| Completion | 1 | 62 024 |
| Completion | 200 | 5 760 022 |

MAX_BATCH=200 проходит локально. Константа не изменена. Coverage изменяет bytecode и block limit; gas из coverage не является benchmark. Перед release эти измерения нужно повторить с настройками целевой сети и фактическими максимальными metadata.

## Итог проверки (2026-09-07)

- Создано 104 теста; финальный обычный прогон после повторного compile: **104 passed, 0 failed, 0 skipped** (9 секунд). Coverage-прогон: также **104 passed, 0 failed**. Compile: 34 Solidity files успешно.
- Production source coverage: **100% statements, 100% functions, 100% lines**. ATCOINCore branches: **99,12%**; единственная непокрытая ветка — `InvalidAmount` на строке 233, недостижимая при supply invariant. ATCOINProxy: 100%.
- Blacklisted spender с finite и infinite allowance заблокирован; failed transferFrom сохраняет allowance.
- Cap, rollback batch, burn accounting, unique completion и initialization security проходят.
- OpenZeppelin storage validation текущего ATCOINCore → V2 проходит; несовместимость в этой паре не обнаружена. Историческая deployment-совместимость не установлена.
- Подтверждённых дефектов production-логики в проверенном scope не выявлено. Replay, trusted report и пустой withdrawal destination остаются существенными рисками при ошибках/компрометации off-chain custodian.
- `npm audit --json`: 39 advisories (15 low, 18 moderate, 6 high), относящихся к дереву инструментов разработки. Это результат npm audit на момент запуска, не 39 уязвимостей Solidity; автоматический breaking upgrade зависимостей не выполнялся.

**Production verdict: NO-GO для безусловного production release по имеющимся данным.** Сам автоматизированный suite проходит. Для release отсутствуют подтверждение целевой сети/gas limits и проверка операционных гарантий custodial bridge: replay deduplication, destination validation, reserves/finality и достоверность completion. Для обновления существующего deployment дополнительно обязателен исторический storage baseline. Эти ограничения не являются падением тестов и не означают, что заявленная event-only бизнес-логика самовольно изменена.
