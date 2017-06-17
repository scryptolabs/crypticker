const colors = require('colors');
const leftPad = require('left-pad');
const rightPad = require('right-pad');
const needle = require('needle');
const moment = require('moment');
const _ = require('lodash');
const os = require('os');
const fs = require('fs');
const yargs = require('yargs');
const Promise = require('bluebird');
const url = require('url');
let options = require('./options.json');

const args = yargs.argv;
const get = Promise.promisify(needle.get, needle);

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

  // Set exchanges
  if (args.exchanges && args.exchanges.length) {
    options.exchanges = args.exchanges.replace(/[^A-Za-z,:]/g, '').split(',');
  }

  // Set timeframe
  if (args.timeframe) {
    options.timeframe = args.timeframe;
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
const writeToStdout = (error, priceData) => {
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

    statusOutput = colors.red(error) + lastUpdateText;
  }

  // Loop through primary currencies
  _.forEach(_.keys(outputData).sort(), (primaryCurrency) => {
    const secondaryCurrencies = _.keys(outputData[primaryCurrency]);

    // Loop through secondary currencies
    _.forEach(secondaryCurrencies, (secondaryCurrency) => {
      const currentPriceData = outputData[primaryCurrency][secondaryCurrency];
      const changePercentageFixed = (+currentPriceData[`percent_change_${options.timeframe.toLowerCase()}_${secondaryCurrency.toLowerCase()}`]).toFixed(2);
      const secondaryCurrencyOutput = secondaryCurrency.toUpperCase() + leftPad('', options.padding);
      const currentPriceKey = `price_${secondaryCurrency.toLowerCase()}`;
      let currentPriceValue = +currentPriceData[currentPriceKey];
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

      // Do not show change output for non-USD until API supports it
      if (secondaryCurrency.toLowerCase() !== 'usd') {
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
        const previousPriceValue = (previousPriceData[primaryCurrency][secondaryCurrency][currentPriceKey]);
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

        priceDataHistory[dataKey] = priceDataHistory[dataKey] || new Array(options.history.length).fill(options.history.neutralSymbol);

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

  previousPrimaryCurrency = null;
  previousPriceData = outputData;

  return true;
};

// Validate supplied options
const validateOptions = () => {
  // eslint-disable-next-line max-len
  const supportedTimeframes = ['1h', '24h', '7d'];

  if (
    !options.exchanges.length ||
    supportedTimeframes.indexOf(options.timeframe.toLowerCase()) === -1
  ) {
    writeToStdout(' ⚠ Supplied options are invalid', null);

    return false;
  }

  return true;
};

// Create list of secondary currencies
const listSecondaryCurrencies = () => {
  let secondaries = [];

  if (!options.exchanges.length) {
    return;
  }

  options.exchanges.forEach(exchange => {
    const [primary, secondary] = exchange.split(':');

    secondaries.push(secondary);
  });

  return _.uniq(secondaries);
};

// Retrieve pricing information from endpoint
const retrieveMarketData = () => {
  const priceData = {};
  const currencyNames = [];
  const secondaryCurrencies = listSecondaryCurrencies();
  const endpoints = secondaryCurrencies.map(currency => `https://api.coinmarketcap.com/v1/ticker/?convert=${currency}`);
  let exchangeData = {};
  let current = Promise.fulfilled();

  // Async calls to API, one for each requested currency
  Promise.map(endpoints, endpoint => {
    current = current.then(function () {
      return get(endpoint);
    });

    return current;
  }).map(response => response).then(results => {
    results.forEach(result => {
      const parsedUrl = url.parse(result.req.path, true);

      // Flatten data values into single currency object
      result.body.forEach(item => {
        exchangeData[item.symbol] = exchangeData[item.symbol] || {};
        // Unfortunately, API doesn't calculate 24 hour percentage changes per conversion currency
        item[`percent_change_1h_${parsedUrl.query.convert.toLowerCase()}`] = item.percent_change_1h;
        item[`percent_change_24h_${parsedUrl.query.convert.toLowerCase()}`] = item.percent_change_24h;
        item[`percent_change_7d_${parsedUrl.query.convert.toLowerCase()}`] = item.percent_change_7d;
        item = _.omit(item, [
          'id',
          'available_supply',
          'total_supply',
          'percent_change_1h',
          'percent_change_24h',
          'percent_change_7d',
          'last_updated'
        ]);
        _.merge(exchangeData[item.symbol], item);
      });
    });

    // Create multi dimensional data structure for exchanges
    options.exchanges.forEach(exchange => {
      const [primary, secondary] = exchange.split(':');
      const match = _.find(exchangeData, { symbol: primary.toUpperCase() });

      if (match) {
        currencyNames.push(match.name);
        priceData[primary] = priceData[primary] || {};
        priceData[primary][secondary] = priceData[primary][secondary] || {};
        priceData[primary][secondary] = match;
      }
    });

    const sortedCurrencyNames = currencyNames.sort((a, b) => b.length - a.length);

    // Calculate length of longest currency name
    priceData.longestCurrencyNameLength = sortedCurrencyNames && sortedCurrencyNames[0] && sortedCurrencyNames[0].length;

    if (priceData && sortedCurrencyNames.length) {
      return writeToStdout(null, priceData);
    }
  }).catch(e => {
    console.log(e);
    return writeToStdout(' ⚠ Data retrieval error', null);
  });
};

// Kick out the jams
if (validateOptions()) {
  setInterval(() => {
    retrieveMarketData();
  }, options.pollInterval);
  retrieveMarketData();
}
