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
    options.history.enabled = false;
  }

  // Set interval
  if (parseInt(args.interval, 10)) {
    options.pollInterval = parseInt(args.interval, 10);
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
let statusOutput = '';
const lastUpdate = +Date.now();
const writeToStdout = (limitReached, priceData) => {
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
  }

  const sortedPrimaryCurrencies = _.keys(outputData).sort();

  _.forEach(sortedPrimaryCurrencies, (primaryCurrency) => {
    const secondaryCurrencies = _.keys(outputData[primaryCurrency]);

    _.forEach(secondaryCurrencies, (secondaryCurrency) => {
      const currentPriceData = outputData[primaryCurrency][secondaryCurrency];
      const changePercentage = +currentPriceData[`percent_change_${options.changeTimeframe}`];
      const changePercentageFixed = (+changePercentage).toFixed(2);
      const secondaryCurrencyOutput = secondaryCurrency + leftPad('', options.padding);
      const currentPriceKey = `price_${secondaryCurrency.toLowerCase()}`;
      let lastPriceValue = +currentPriceData[currentPriceKey];
      let primaryCurrencyOutput = '';
      let changeOutput = '';
      let historyChangeOutput = '';

      // Show primary currency name
      if (previousPrimaryCurrency !== primaryCurrency) {
        primaryCurrencyOutput = colors.bold.white(
          ` › ${rightPad(currentPriceData.name, priceData.longestCurrencyNameLength)}`
        ) + leftPad('', options.padding);
        previousPrimaryCurrency = primaryCurrency;
      } else {
        primaryCurrencyOutput = colors.bold(
          rightPad(' ', priceData.longestCurrencyNameLength + 3)
        ) + leftPad('', options.padding);
      }

      // Show percent change in last 24 hours
      if (changePercentageFixed > 0) {
        changeOutput = rightPad(colors.green(`▲ ${changePercentageFixed.toString()}%`), 8);
      } else if (changePercentageFixed < 0) {
        changeOutput = rightPad(colors.red(`▼ ${(changePercentageFixed * -1).toFixed(2).toString()}%`), 8);
      } else {
        changeOutput = rightPad(`- ${changePercentageFixed.toString()}%`, 8);
      }

      // Do not show change output for BTC
      if (secondaryCurrency === 'BTC') {
        changeOutput = rightPad(' ', 7);
      }

      // Show history of price updates
      if (
        options.history.enabled &&
        previousPriceData &&
        previousPriceData[primaryCurrency] &&
        previousPriceData[primaryCurrency][secondaryCurrency] &&
        +(previousPriceData[primaryCurrency][secondaryCurrency][currentPriceKey])
      ) {
        const currentLastPrice = lastPriceValue.toFixed(2);
        const previousLastPrice = (previousPriceData[primaryCurrency][secondaryCurrency][currentPriceKey]);
        const majorThreshold = options.history.majorThreshold;
        const dataKey = primaryCurrency + secondaryCurrency;
        let symbol;

        // Determine history symbol
        if (Math.abs(currentLastPrice - previousLastPrice).toFixed(2) > majorThreshold) {
          symbol = currentLastPrice > previousLastPrice ?
            options.history.positiveMajorSymbol :
            options.history.negativeMajorSymbol;
        } else {
          symbol = currentLastPrice > previousLastPrice ?
            options.history.positiveMinorSymbol :
            options.history.negativeMinorSymbol;
        }

        priceDataHistory[dataKey] = priceDataHistory[dataKey] || new Array(options.history.length).fill(' ');

        if (
          currentLastPrice > previousLastPrice &&
          currentLastPrice - previousLastPrice > options.history.minorThreshold
        ) {
          // Price has increased since last update and was greater than threshold
          priceDataHistory[dataKey].push(colors.green.bold(symbol));
        } else if (
          currentLastPrice < previousLastPrice &&
          previousLastPrice - currentLastPrice > options.history.minorThreshold
        ) {
          // Price has decreased since last update and was greater than threshold
          priceDataHistory[dataKey].push(colors.red.bold(symbol));
        } else {
          priceDataHistory[dataKey].push(colors.grey(options.history.neutralSymbol));
        }

        historyChangeOutput = (currentLastPrice - previousLastPrice).toFixed(2);

        if (historyChangeOutput >= 0) {
          historyChangeOutput = `+${Math.abs(historyChangeOutput).toFixed(2)}`;
        }
      }

      if (lastPriceValue < 1) {
        lastPriceValue = lastPriceValue.toFixed(4);
      } else {
        lastPriceValue = utility.addCommas(lastPriceValue.toFixed(2));
      }

      // eslint-disable-next-line prefer-template, no-useless-concat, max-len
      process.stdout.write(primaryCurrencyOutput + secondaryCurrencyOutput + leftPad(lastPriceValue, 10) + ' ' + changeOutput + ` ${(priceDataHistory[primaryCurrency + secondaryCurrency] || '') && priceDataHistory[primaryCurrency + secondaryCurrency].slice(-1 * options.history.length).join('')}` + ` ${colors.grey(historyChangeOutput)}` + '\n');
    });

    process.stdout.write('\n');
  });

  process.stdout.write(`${statusOutput}`);

  previousPrimaryCurrency = null;
  previousPriceData = outputData;

  return true;
};

// Retrieve pricing information from endpoint
const retrieveMarketData = () => {
  const priceData = {};
  const currencyNames = [];

  needle.get(`https://api.coinmarketcap.com/v1/ticker/?convert=${options.currency}`, (error, response) => {
    const body = response && response.body;

    if (!error && body && response.statusCode === 200) {
      _.forEach(options.currencies, (currency) => {
        const match = _.find(body, { symbol: currency.toUpperCase() });

        if (!match) {
          return;
        }

        const primaryCurrency = currency.toUpperCase();
        const secondaryCurrency = options.currency.toUpperCase();

        currencyNames.push(match.name);
        priceData[primaryCurrency] = priceData[primaryCurrency] || {};
        priceData[primaryCurrency][secondaryCurrency] = priceData[primaryCurrency][secondaryCurrency] || {};
        priceData[primaryCurrency][secondaryCurrency] = match;

        if (options.displayPriceBTC) {
          priceData[primaryCurrency].BTC = priceData[primaryCurrency].BTC || {};
          priceData[primaryCurrency].BTC = match;
        }
      });

      const sortedCurrencyNames = currencyNames.sort((a, b) => b.length - a.length);

      // Calculate length of longest currency name
      priceData.longestCurrencyNameLength = sortedCurrencyNames && sortedCurrencyNames[0] && sortedCurrencyNames[0].length;

      if (priceData) {
        return writeToStdout(null, priceData);
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
}, options.pollInterval);
retrieveMarketData();
