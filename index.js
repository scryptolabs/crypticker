const colors = require('colors');
const leftPad = require('left-pad');
const rightPad = require('right-pad');
const needle = require('needle');
const moment = require('moment');
const _ = require('lodash');
const os = require('os');
const fs = require('fs');
const yargs = require('yargs');
let options = require('./options.json');

const args = yargs.argv;

// Check for local configuration
if (fs.existsSync(`${os.homedir()}/.crypticker`)) {
  options = JSON.parse(fs.readFileSync(`${os.homedir()}/.crypticker`, 'utf8'));
}

// Handle arguments
if (args) {
  // Disable history
  if (args.nohistory) {
    options.app.history.enabled = false;
  }

  // Set interval
  if (parseInt(args.interval, 10)) {
    options.app.pollInterval = parseInt(args.interval, 10);
  }

  if (args.markets && args.markets.length) {
    options.markets = args.markets.replace(' ', '').split(',');
  }
}

// Utility functions
const utility = {
  // Convert string to title case
  toTitleCase: string => string.replace(/\w\S*/g, text => text.charAt(0).toUpperCase() + text.substr(1).toLowerCase()),

  // Add commas to number
  addCommas: string => string.toString().replace(/(\d)(?=(\d\d\d)+(?!\d))/g, '$1,')
};

// Write display to STDOUT
let previousPriceData = {};
const priceDataHistory = {};
let previousPrimaryCurrency = null;
let previousSecondaryCurrency = null;
let statusOutput = '';
let lastUpdate = +Date.now();
const writeToStdout = (limitReached, priceData, allowance) => {
  let outputData = priceData;

  // Clear screen
  process.stdout.write('\x1Bc');
  process.stdout.write('\n');

  // Set status message for connectivity or API limit issues
  if (!priceData) {
    const lastUpdateText = colors.grey(` / Last updated ${moment(lastUpdate).fromNow()}\n\n`);

    if (_.keys(previousPriceData).length) {
      outputData = previousPriceData;
    }

    if (limitReached) {
      statusOutput = colors.red(' ⚠ API limit has been reached') + lastUpdateText;
    } else {
      statusOutput = colors.red(' ⚠ Data retrieval error') + lastUpdateText;
    }
  } else if (allowance && allowance.remaining < 100000000) {
    statusOutput = colors.yellow(' ⚠ API limit is close to being reached\n\n');
  } else {
    lastUpdate = +Date.now();
    statusOutput = '';
  }

  const sortedPrimaryCurrencies = _.keys(outputData).sort();

  _.forEach(sortedPrimaryCurrencies, (primaryCurrency) => {
    const sortedSecondaryCurrencies = _.keys(outputData[primaryCurrency]).sort();

    _.forEach(sortedSecondaryCurrencies, (secondaryCurrency) => {
      const sortedExchanges = _.keys(outputData[primaryCurrency][secondaryCurrency]).sort();

      _.forEach(sortedExchanges, (exchange) => {
        const exchangePriceData = outputData[primaryCurrency][secondaryCurrency][exchange];
        const changePercentage = exchangePriceData.price.change.percentage * 100;
        const changePercentageFixed = (changePercentage).toFixed(2);
        let lastPriceValue = outputData[primaryCurrency][secondaryCurrency][exchange].price.last;
        let primaryCurrencyOutput = '';
        let secondaryCurrencyOutput = '';
        let exchangeOutput = '';
        let changeOutput = '';
        let historyChangeOutput = '';

        // Show primary currency name
        if (previousPrimaryCurrency !== primaryCurrency) {
          primaryCurrencyOutput = colors.bold.white(` › ${primaryCurrency}`) + leftPad('', options.app.padding);
          previousPrimaryCurrency = primaryCurrency;
        } else {
          primaryCurrencyOutput = colors.bold(leftPad('', 3 + 3)) + leftPad('', options.app.padding);
        }

        // Show secondary currency name
        if (previousSecondaryCurrency !== secondaryCurrency) {
          secondaryCurrencyOutput = secondaryCurrency + leftPad('', options.app.padding);
          previousSecondaryCurrency = secondaryCurrency;
        } else {
          secondaryCurrencyOutput = leftPad('', 3) + leftPad('', options.app.padding);
        }

        // Show exchange name
        exchangeOutput = rightPad(exchange, outputData.longestExchangeLength) + leftPad('', options.app.padding);

        // Show percent change in last 24 hours
        if ((exchangePriceData.price.change.percentage * 100).toFixed(2) > 0) {
          changeOutput = rightPad(colors.green(`▲ ${changePercentageFixed.toString()}%`), 8);
        } else if ((exchangePriceData.price.change.percentage * 100).toFixed(2) < 0) {
          changeOutput = rightPad(colors.red(`▼ ${(changePercentageFixed * -1).toFixed(2).toString()}%`), 8);
        } else {
          changeOutput = rightPad(`- ${changePercentageFixed.toString()}%`, 8);
        }

        // Show history of price updates
        if (
          options.app.history.enabled &&
          previousPriceData &&
          previousPriceData[primaryCurrency] &&
          previousPriceData[primaryCurrency][secondaryCurrency] &&
          previousPriceData[primaryCurrency][secondaryCurrency][exchange] &&
          +(previousPriceData[primaryCurrency][secondaryCurrency][exchange].price.last)
        ) {
          const currentLastPrice = exchangePriceData.price.last.toFixed(2);
          const previousExchangeData = previousPriceData[primaryCurrency][secondaryCurrency][exchange];
          const previousLastPrice = previousExchangeData.price.last.toFixed(2);
          const majorThreshold = options.app.history.majorThreshold;
          const dataKey = primaryCurrency + secondaryCurrency + exchange;
          let symbol;

          // Determine history symbol
          if (Math.abs(currentLastPrice - previousLastPrice).toFixed(2) > majorThreshold) {
            symbol = currentLastPrice > previousLastPrice ?
              options.app.history.positiveMajorSymbol :
              options.app.history.negativeMajorSymbol;
          } else {
            symbol = currentLastPrice > previousLastPrice ?
              options.app.history.positiveMinorSymbol :
              options.app.history.negativeMinorSymbol;
          }

          priceDataHistory[dataKey] = priceDataHistory[dataKey] || new Array(options.app.history.length).fill(' ');

          if (
            currentLastPrice > previousLastPrice &&
            currentLastPrice - previousLastPrice > options.app.history.minorThreshold
          ) {
            // Price has increased since last update and was greater than threshold
            priceDataHistory[dataKey].push(colors.green.bold(symbol));
          } else if (
            currentLastPrice < previousLastPrice &&
            previousLastPrice - currentLastPrice > options.app.history.minorThreshold
          ) {
            // Price has decreased since last update and was greater than threshold
            priceDataHistory[dataKey].push(colors.red.bold(symbol));
          } else {
            priceDataHistory[dataKey].push(colors.grey(options.app.history.neutralSymbol));
          }

          historyChangeOutput = (currentLastPrice - previousLastPrice).toFixed(2);

          if (historyChangeOutput >= 0) {
            historyChangeOutput = `+${Math.abs(historyChangeOutput)}`;
          }
        }

        if (lastPriceValue < 1) {
          lastPriceValue = lastPriceValue.toFixed(4);
        } else {
          lastPriceValue = utility.addCommas(lastPriceValue.toFixed(2));
        }

        // eslint-disable-next-line prefer-template, no-useless-concat, max-len
        process.stdout.write(primaryCurrencyOutput + secondaryCurrencyOutput + exchangeOutput + leftPad(lastPriceValue, 10) + ' ' + changeOutput + ` ${(priceDataHistory[primaryCurrency + secondaryCurrency + exchange] || '') && priceDataHistory[primaryCurrency + secondaryCurrency + exchange].slice(-1 * options.app.history.length).join('')}` + ` ${colors.grey(historyChangeOutput)}` + '\n');
      });

      process.stdout.write('\n');
    });
  });

  process.stdout.write(`${statusOutput}`);

  previousPrimaryCurrency = null;
  previousSecondaryCurrency = null;
  previousPriceData = outputData;

  return true;
};

// Retrieve pricing information from endpoint
const retrieveMarketData = () => {
  const priceData = {};
  const exchanges = [];

  needle.get('https://api.cryptowat.ch/markets/summaries', (error, response) => {
    const body = response && response.body;

    if (!error && body && response.statusCode === 200) {
      _.forEach(body.result, (data, market) => {
        if (options.markets.indexOf(market) === -1) {
          return;
        }

        const [exchange, marketName] = market.split(':');
        const primaryCurrency = marketName.substr(0, 3).toUpperCase();
        const secondaryCurrency = marketName.substr(3, 3).toUpperCase();

        exchanges.push(exchange);
        priceData[primaryCurrency] = priceData[primaryCurrency] || {};
        priceData[primaryCurrency][secondaryCurrency] = priceData[primaryCurrency][secondaryCurrency] || {};
        priceData[primaryCurrency][secondaryCurrency][utility.toTitleCase(exchange)] = body && body.result[market];
      });

      const sortedExchanges =  exchanges.sort((a, b) => b.length - a.length);

      priceData.longestExchangeLength = sortedExchanges && sortedExchanges[0] && sortedExchanges[0].length;

      if (priceData) {
        return writeToStdout(null, priceData, response.body.allowance);
      }
    } else if (response && response.statuscode === 429) {
      return writeToStdout(true);
    }

    return writeToStdout(false, null);
  });
};

// Kick out the jams
setInterval(() => {
  retrieveMarketData();
}, options.app.pollInterval);
retrieveMarketData();
