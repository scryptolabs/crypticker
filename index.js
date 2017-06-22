const colors = require('colors');
const leftPad = require('left-pad');
const rightPad = require('right-pad');
const needle = require('needle');
const moment = require('moment');
const _ = require('lodash');
const os = require('os');
const fs = require('fs');
const yargs = require('yargs');
const async = require('async');
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
    options.interval = parseInt(args.interval, 10);
  }

  // Set exchanges
  if (args.exchanges && args.exchanges.length) {
    options.exchanges = args.exchanges.replace(/[^A-Za-z,:]/g, '').split(',');
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
const writeToStdout = (message, priceData) => {
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

    statusOutput = message + lastUpdateText;
  }

  const currencyNames = _.keys(outputData);
  const sortedCurrencyNames = currencyNames.sort((a, b) => b.length - a.length);
  const longestCurrencyNameLength = sortedCurrencyNames && sortedCurrencyNames[0] && sortedCurrencyNames[0].length;

  // Loop through primary currencies
  _.forEach(_.keys(outputData).sort(), (primaryCurrency) => {
    const secondaryCurrencies = _.keys(outputData[primaryCurrency]);

    // Loop through secondary currencies
    _.forEach(secondaryCurrencies, (secondaryCurrency) => {
      const currentPriceData = outputData[primaryCurrency][secondaryCurrency];
      const changePercentageFixed = (+((currentPriceData.change / currentPriceData.price) * 100)).toFixed(2);
      const secondaryCurrencyOutput = secondaryCurrency.toUpperCase() + leftPad('', options.padding);
      let currentPriceValue = +currentPriceData.price;
      let primaryCurrencyOutput = '';
      let changeOutput = '';
      let historyChangeOutput = '';

      if (!currentPriceData) {
        return;
      }

      // Show primary currency name
      if (previousPrimaryCurrency !== primaryCurrency) {
        primaryCurrencyOutput = colors.bold.white(
          ` › ${rightPad(primaryCurrency, longestCurrencyNameLength)}`
        ) + leftPad('', options.padding);
        previousPrimaryCurrency = primaryCurrency;
      } else {
        primaryCurrencyOutput = colors.bold(
          rightPad(' ', longestCurrencyNameLength + 3)
        ) + leftPad('', options.padding);
      }

      // Show percent change in last 24 hours
      if (changePercentageFixed > 0) {
        changeOutput = colors.green(rightPad(`▲ ${changePercentageFixed.toString()}%`, 8));
      } else if (changePercentageFixed < 0) {
        changeOutput = colors.red(rightPad(`▼ ${(changePercentageFixed * -1).toFixed(2).toString()}%`, 8));
      } else {
        changeOutput = rightPad(`  ${changePercentageFixed.toString()}%`, 8);
      }

      // Do not show change output if change is smaller than displayed floating point
      if (changePercentageFixed === '-0.00') {
        changeOutput = rightPad(' ', 8);
      }

      // Show history of price updates
      if (
        options.history.enabled &&
        previousPriceData &&
        previousPriceData[primaryCurrency] &&
        previousPriceData[primaryCurrency][secondaryCurrency] &&
        +(previousPriceData[primaryCurrency][secondaryCurrency].price)
      ) {
        const previousPriceValue = (previousPriceData[primaryCurrency][secondaryCurrency].price);
        const majorThreshold = options.history.majorThreshold;
        const dataKey = primaryCurrency + secondaryCurrency;
        let symbol;

        // Determine history symbol
        if (Math.abs(currentPriceValue - previousPriceValue).toFixed(8) > majorThreshold) {
          symbol = currentPriceValue > previousPriceValue ?
            options.history.positiveMajorSymbol :
            options.history.negativeMajorSymbol;
        } else {
          symbol = currentPriceValue > previousPriceValue ?
            options.history.positiveMinorSymbol :
            options.history.negativeMinorSymbol;
        }

        priceDataHistory[dataKey] = priceDataHistory[dataKey] || new Array(options.history.length).fill(' ');

        if (
          currentPriceValue > previousPriceValue &&
          currentPriceValue - previousPriceValue > options.history.minorThreshold
        ) {
          // Price has increased since last update and was greater than threshold
          priceDataHistory[dataKey].push(colors.green.bold(symbol));
        } else if (
          currentPriceValue < previousPriceValue &&
          previousPriceValue - currentPriceValue > options.history.minorThreshold
        ) {
          // Price has decreased since last update and was greater than threshold
          priceDataHistory[dataKey].push(colors.red.bold(symbol));
        } else {
          priceDataHistory[dataKey].push(colors.grey(options.history.neutralSymbol));
        }

        historyChangeOutput = (currentPriceValue - previousPriceValue).toFixed(2);

        if (historyChangeOutput >= 0) {
          historyChangeOutput = `+${Math.abs(historyChangeOutput).toFixed(2)}`;
        }
      }

      if (currentPriceValue < 1) {
        currentPriceValue = currentPriceValue.toFixed(4);
      } else {
        currentPriceValue = utility.addCommas(currentPriceValue.toFixed(2));
      }

      // eslint-disable-next-line prefer-template, no-useless-concat, max-len
      process.stdout.write(primaryCurrencyOutput + secondaryCurrencyOutput + leftPad(currentPriceValue, 10) + ' ' + changeOutput + ` ${(priceDataHistory[primaryCurrency + secondaryCurrency] || '') && priceDataHistory[primaryCurrency + secondaryCurrency].slice(-1 * options.history.length).join('')}` + ` ${colors.grey(historyChangeOutput)}` + '\n');
    });

    process.stdout.write('\n');
  });

  process.stdout.write(`${statusOutput}`);
  statusOutput = '';

  previousPrimaryCurrency = null;
  previousPriceData = outputData;

  return true;
};

// Validate supplied options
const validateOptions = () => {
  if (
    !options.exchanges.length
  ) {
    writeToStdout(colors.red(' ⚠ Supplied options are invalid'), null);

    return false;
  }

  return true;
};

// Format data retrieved from market endpoint
const formatMarketData = (results, currencies) => {
  const priceData = {};

  // Create multi dimensional data structure for exchanges
  results.forEach((result) => {
    let currencyName = _.find(currencies, { code: result.base });

    currencyName = (currencyName && currencyName.name) || result.base;
    priceData[currencyName] = priceData[currencyName] || {};
    priceData[currencyName][result.target] = priceData[currencyName][result.target] || {};
    priceData[currencyName][result.target] = result;
  });

  if (priceData && _.keys(priceData).length) {
    return writeToStdout(null, priceData);
  }

  return false;
};


// Retrieve list of cryptocurrencies
let currencyCache = null;
const retrieveCurrencies = (callback) => {
  if (currencyCache) {
    return callback(currencyCache);
  }

  return needle.get('https://api.cryptonator.com/api/currencies', {
    open_timeout: 60000
  }, (currenciesErr, currenciesResponse, currencies) => {
    if (currenciesErr) {
      return writeToStdout(colors.red(' ⚠ Data retrieval error'), null);
    }

    currencyCache = currencies;

    return callback(currencies);
  });
};

// Retrieve pricing information from endpoint
const retrieveMarketData = () => {
  const endpoints = options.exchanges.map(exchange => `https://api.cryptonator.com/api/ticker/${exchange.replace(':', '-')}`);

  // Retrieve list of cryptocurrencies
  retrieveCurrencies(currencies =>
    // Async calls to API, one for each requested currency
    async.mapSeries(endpoints, (endpoint, done) => {
      needle.get(endpoint, {
        open_timeout: 60000
      }, (currencyErr, currencyResponse, currency) => {
        if (currencyErr) {
          return done(currencyErr);
        }

        return done(null, currency && currency.ticker);
      });
    }, (err, results) => {
      if (err) {
        return writeToStdout(colors.red(' ⚠ Data retrieval error'), null);
      }

      return formatMarketData(results, currencies && currencies.rows);
    })
  );
};

// Kick out the jams
if (validateOptions()) {
  setInterval(() => {
    retrieveMarketData();
  }, options.interval * 1000);
  writeToStdout(colors.yellow(' ⚠ Retrieving data...'), null);
  retrieveMarketData();
}
