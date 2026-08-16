const n=(name,fallback)=>process.env[name]==null||process.env[name]===''?fallback:Number(process.env[name]);
const b=(name,fallback)=>process.env[name]==null||process.env[name]===''?fallback:['1','true','yes','on'].includes(String(process.env[name]).toLowerCase());
const s=(name,fallback='')=>process.env[name]??fallback;
export const SOL_MINT='So11111111111111111111111111111111111111112';
export const config={
  tradingMode:s('TRADING_MODE','paper').toLowerCase(),
  liveAck:s('LIVE_TRADING_ACK',''),
  bankroll:n('PAPER_BANKROLL_USD',11),
  maxPosition:n('MAX_POSITION_USD',2),
  maxDailyLoss:n('MAX_DAILY_LOSS_USD',1),
  livePositionUsd:n('LIVE_POSITION_USD',2),
  minSolReserve:n('MIN_SOL_RESERVE',0.003),
  stopLossPct:n('STOP_LOSS_PCT',15),
  takeProfitPct:n('TAKE_PROFIT_PCT',50),
  trailArmPct:n('TRAIL_ARM_PCT',25),
  trailDrawdownPct:n('TRAIL_DRAWDOWN_PCT',12),
  minScore:n('MIN_SCORE',90),
  pollSeconds:n('POLL_SECONDS',30),
  maxTokenAgeMinutes:n('MAX_TOKEN_AGE_MINUTES',240),
  minLiquidity:n('MIN_LIQUIDITY_USD',25000),
  min5mVolume:n('MIN_5M_VOLUME_USD',10000),
  minMarketCap:n('MIN_MARKET_CAP_USD',50000),
  maxMarketCap:n('MAX_MARKET_CAP_USD',5000000),
  heliusApiKey:s('HELIUS_API_KEY'),
  jupiterApiKey:s('JUPITER_API_KEY'),
  bs58PrivateKey:s('BS58_PRIVATE_KEY'),
  expectedWalletAddress:s('EXPECTED_WALLET_ADDRESS'),
  telegramBotToken:s('TELEGRAM_BOT_TOKEN'),telegramChatId:s('TELEGRAM_CHAT_ID'),
  runOnce:process.env.RUN_ONCE==='1',
  xPostingEnabled:b('X_POSTING_ENABLED',false),xApiKey:s('X_API_KEY'),xApiSecret:s('X_API_SECRET'),xAccessToken:s('X_ACCESS_TOKEN'),xAccessTokenSecret:s('X_ACCESS_TOKEN_SECRET'),xDailyReportHourUtc:n('X_DAILY_REPORT_HOUR_UTC',23),
  dataDir:s('DATA_DIR','.'),port:n('PORT',3000),
  launchTxLimit:n('LAUNCH_TX_LIMIT',100),launchWindowSeconds:n('LAUNCH_WINDOW_SECONDS',180),minLaunchTxForConfidence:n('MIN_LAUNCH_TX_FOR_CONFIDENCE',4),
  clusterWalletThreshold:n('CLUSTER_WALLET_THRESHOLD',4),clusterRepeatThreshold:n('CLUSTER_REPEAT_THRESHOLD',3),crowdedSlotsHigh:n('CROWDED_SLOTS_HIGH',2),
  maxFundingWalletChecks:n('MAX_FUNDING_WALLET_CHECKS',8),fundingHistoryLimit:n('FUNDING_HISTORY_LIMIT',30),fundingLookbackSeconds:n('FUNDING_LOOKBACK_SECONDS',86400),sharedFunderHighWallets:n('SHARED_FUNDER_HIGH_WALLETS',4),
  bundleSupplyMediumPct:n('BUNDLE_SUPPLY_MEDIUM_PCT',5),bundleSupplyElevatedPct:n('BUNDLE_SUPPLY_ELEVATED_PCT',10),bundleSupplyHighPct:n('BUNDLE_SUPPLY_HIGH_PCT',20),
  holderTop1MediumPct:n('HOLDER_TOP1_MEDIUM_PCT',10),holderTop1HighPct:n('HOLDER_TOP1_HIGH_PCT',20),holderTop5MediumPct:n('HOLDER_TOP5_MEDIUM_PCT',25),holderTop5HighPct:n('HOLDER_TOP5_HIGH_PCT',40),holderTop10MediumPct:n('HOLDER_TOP10_MEDIUM_PCT',40),holderTop10HighPct:n('HOLDER_TOP10_HIGH_PCT',60)
};
export function liveConfigStatus(){
  const missing=[];
  if(!config.heliusApiKey)missing.push('HELIUS_API_KEY');
  if(!config.jupiterApiKey)missing.push('JUPITER_API_KEY');
  if(!config.bs58PrivateKey)missing.push('BS58_PRIVATE_KEY');
  if(config.liveAck!=='I_UNDERSTAND_REAL_FUNDS_ARE_AT_RISK')missing.push('LIVE_TRADING_ACK');
  return {ready:missing.length===0,missing};
}
