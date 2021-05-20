// @ts-check

// eslint-disable-next-line import/no-extraneous-dependencies
import { test } from '@agoric/zoe/tools/prepare-test-env-ava';
import { AmountMath } from '@agoric/ertp';
import {
  getInputPrice,
  getOutputPrice,
  natSafeMath,
} from '../../../../src/contractSupport';
import { setup } from '../../setupBasicMints';
import { makeGetCurrentPrice } from '../../../../src/contracts/newSwap/getCurrentPrice';
import {
  outputFromInputPrice,
  priceFromTargetOutput,
} from '../../../autoswapJig';

const { add, subtract, floorDivide, multiply } = natSafeMath;
const BASIS_POINTS = 10000n;

function makeFakePool(initCentral, initSecondary) {
  let centralBalance = initCentral.value;
  let secondaryBalance = initSecondary.value;

  const pool = {
    getPriceGivenAvailableInput: (inputAmount, outputBrand, feeBP = 30n) => {
      const [inputReserve, outputReserve] =
        outputBrand === initCentral.brand
          ? [secondaryBalance, centralBalance]
          : [centralBalance, secondaryBalance];

      const valueOut = getInputPrice(
        inputAmount.value,
        inputReserve,
        outputReserve,
        feeBP,
      );
      const valueIn = getOutputPrice(
        valueOut,
        inputReserve,
        outputReserve,
        feeBP,
      );
      return {
        amountOut: AmountMath.make(valueOut, outputBrand),
        amountIn: AmountMath.make(valueIn, inputAmount.brand),
      };
    },

    getPriceGivenRequiredOutput: (inputBrand, outputAmount, feeBP = 30n) => {
      const [inputReserve, outputReserve] =
        inputBrand === initSecondary.brand
          ? [secondaryBalance, centralBalance]
          : [centralBalance, secondaryBalance];
      const valueIn = getOutputPrice(
        outputAmount.value,
        inputReserve,
        outputReserve,
        feeBP,
      );
      const valueOut = getInputPrice(
        valueIn,
        inputReserve,
        outputReserve,
        feeBP,
      );
      return {
        amountOut: AmountMath.make(valueOut, outputAmount.brand),
        amountIn: AmountMath.make(valueIn, inputBrand),
      };
    },
  };

  const poolAdmin = {
    toCentral: (centralChange, secondaryChange) => {
      centralBalance = add(centralBalance, centralChange);
      secondaryBalance = subtract(secondaryBalance, secondaryChange);
    },
    toSecondary: (centralChange, secondaryChange) => {
      centralBalance = subtract(centralBalance, centralChange);
      secondaryBalance = add(secondaryBalance, secondaryChange);
    },
  };

  return { pool, poolAdmin };
}

function setupPricer(initialMoola, initialBucks, initialSimoleans = 100n) {
  const { bucks, moola, simoleans, brands } = setup();
  const moolaBrand = brands.get('moola');
  const bucksBrand = brands.get('bucks');
  const simoleansBrand = brands.get('simoleans');

  const { pool: bucksPool } = makeFakePool(
    moola(initialMoola),
    bucks(initialBucks),
  );
  // might be nice to specify the amount of moola in the two pools separately
  const { pool: simoleanPool } = makeFakePool(
    moola(initialMoola),
    simoleans(initialSimoleans),
  );

  function getPool(brand) {
    switch (brand) {
      case bucksBrand:
        return bucksPool;
      case simoleansBrand:
        return simoleanPool;
      default:
        throw Error('Pool not found');
    }
  }

  const pricer = makeGetCurrentPrice(
    b => b !== moolaBrand,
    b => b === moolaBrand,
    getPool,
    moolaBrand,
    24n,
    6n,
  );

  return {
    bucks,
    moola,
    simoleans,
    bucksBrand,
    moolaBrand,
    simoleansBrand,
    getPool,
    pricer,
  };
}

function protocolFee(input) {
  return floorDivide(multiply(input, 6n), BASIS_POINTS);
}

test('newSwap getPriceGivenAvailableInput specify central', async t => {
  const initMoola = 800000n;
  const initBucks = 300000n;
  const { bucks, moola, bucksBrand, pricer } = setupPricer(
    initMoola,
    initBucks,
  );

  const input = 10000n;
  const pFeePre = protocolFee(input);

  const valueOut = outputFromInputPrice(
    initMoola,
    initBucks,
    input - pFeePre,
    24n,
  );
  const valueIn = priceFromTargetOutput(valueOut, initBucks, initMoola, 24n);
  const pFee = protocolFee(valueIn);
  t.deepEqual(pricer.getPriceGivenAvailableInput(moola(input), bucksBrand), {
    amountIn: moola(valueIn + pFee),
    amountOut: bucks(valueOut),
    protocolFee: moola(pFee),
  });
  t.truthy(
    (initMoola - valueOut) * (initBucks + valueIn) > initBucks * initMoola,
  );
});

test('newSwap getPriceGivenAvailableInput secondary', async t => {
  const initMoola = 800000n;
  const initBucks = 500000n;
  const { bucks, moola, moolaBrand, pricer } = setupPricer(
    initMoola,
    initBucks,
  );

  const input = 10000n;
  const valueOut = outputFromInputPrice(initBucks, initMoola, input, 24n);
  const pFee = protocolFee(valueOut);
  const valueIn = priceFromTargetOutput(valueOut, initMoola, initBucks, 24n);
  t.deepEqual(pricer.getPriceGivenAvailableInput(bucks(input), moolaBrand), {
    amountIn: bucks(valueIn),
    amountOut: moola(valueOut - pFee),
    protocolFee: moola(pFee),
  });
  t.truthy(
    (initMoola - valueOut) * (initBucks + valueIn) > initBucks * initMoola,
  );
});

test('newSwap getPriceGivenRequiredOutput specify central', async t => {
  const initMoola = 700000n;
  const initBucks = 500000n;
  const { bucks, moola, bucksBrand, pricer } = setupPricer(
    initMoola,
    initBucks,
  );

  const output = 10000n;
  const pFeePre = protocolFee(output);
  const poolChange = output + pFeePre;
  const valueIn = priceFromTargetOutput(poolChange, initMoola, initBucks, 24n);
  const valueOut = outputFromInputPrice(initBucks, initMoola, valueIn, 24n);
  const pFee = protocolFee(valueOut);
  t.deepEqual(pricer.getPriceGivenRequiredOutput(bucksBrand, moola(output)), {
    amountIn: bucks(valueIn),
    amountOut: moola(valueOut - pFee),
    protocolFee: moola(pFee),
  });
  t.truthy(
    (initMoola - valueOut) * (initBucks + valueIn + pFee) >
      initBucks * initMoola,
  );
});

test('newSwap getPriceGivenRequiredOutput specify secondary', async t => {
  const initMoola = 700000n;
  const initBucks = 500000n;
  const { bucks, moola, moolaBrand, pricer } = setupPricer(
    initMoola,
    initBucks,
  );

  const output = 10000n;
  const valueIn = priceFromTargetOutput(output, initBucks, initMoola, 24n);
  const valueOut = outputFromInputPrice(initMoola, initBucks, valueIn, 24n);
  const pFee = protocolFee(valueIn);
  t.deepEqual(pricer.getPriceGivenRequiredOutput(moolaBrand, bucks(output)), {
    amountIn: moola(valueIn + pFee),
    amountOut: bucks(valueOut),
    protocolFee: moola(pFee),
  });
  t.truthy(
    (initMoola - valueOut) * (initBucks + valueIn + pFee) >
      initBucks * initMoola,
  );
});

test('newSwap getPriceGivenAvailableInput twoPools', async t => {
  const initMoola = 800000n;
  const initBucks = 500000n;
  const initSimoleans = 300000n;
  const { bucks, moola, simoleans, simoleansBrand, pricer } = setupPricer(
    initMoola,
    initBucks,
    initSimoleans,
  );

  // get price given input from simoleans to bucks through moola, presuming
  // there will be no price improvement
  const input = 10000n;
  const moolaOut = outputFromInputPrice(initBucks, initMoola, input, 12n);
  const feeOut = floorDivide(multiply(moolaOut, 6), BASIS_POINTS);
  const simOut = outputFromInputPrice(
    initMoola,
    initSimoleans,
    moolaOut - feeOut,
    12n,
  );
  t.deepEqual(
    pricer.getPriceGivenAvailableInput(bucks(input), simoleansBrand),
    {
      amountIn: bucks(input),
      amountOut: simoleans(simOut),
      protocolFee: moola(feeOut),
      centralAmount: moola(moolaOut),
    },
  );
});

test('newSwap getPriceGivenRequiredOutput twoPools', async t => {
  const initMoola = 800000n;
  const initBucks = 500000n;
  const initSimoleans = 300000n;
  const { bucks, moola, simoleans, simoleansBrand, pricer } = setupPricer(
    initMoola,
    initBucks,
    initSimoleans,
  );

  // get price given desired output from simoleans to bucks through moola,
  // choosing 10001 so there will be no price improvement
  const output = 10001n;
  const moolaIn = priceFromTargetOutput(output, initBucks, initMoola, 12n);
  const fee = floorDivide(multiply(moolaIn, 6), BASIS_POINTS);
  const simIn = priceFromTargetOutput(
    moolaIn + fee,
    initMoola,
    initSimoleans,
    12n,
  );
  t.deepEqual(
    pricer.getPriceGivenRequiredOutput(simoleansBrand, bucks(output)),
    {
      amountIn: simoleans(simIn),
      amountOut: bucks(output),
      protocolFee: moola(fee),
      centralAmount: moola(moolaIn),
    },
  );
});

test('newSwap getPriceGivenOutput central extreme', async t => {
  const initMoola = 700000n;
  const initBucks = 500000n;
  const { bucks, moola, bucksBrand, pricer } = setupPricer(
    initMoola,
    initBucks,
  );

  const output = 690000n;
  const pFeePre = protocolFee(output);
  const poolChange = output + pFeePre;
  const valueIn = priceFromTargetOutput(poolChange, initMoola, initBucks, 24n);
  const valueOut = outputFromInputPrice(initBucks, initMoola, valueIn, 24n);
  const pFee = protocolFee(valueOut);
  t.deepEqual(pricer.getPriceGivenRequiredOutput(bucksBrand, moola(output)), {
    amountIn: bucks(valueIn),
    amountOut: moola(valueOut - pFee),
    protocolFee: moola(pFee),
  });

  t.truthy(
    (initMoola - valueOut) * (initBucks + valueIn + pFee) >
      initBucks * initMoola,
  );
});

test('newSwap getPriceGivenInput secondary extreme', async t => {
  const moolaPool = 800000n;
  const bucksPool = 500000n;
  const { bucks, moola, moolaBrand, pricer } = setupPricer(
    moolaPool,
    bucksPool,
  );

  const input = 690000n;
  const valueOut = outputFromInputPrice(bucksPool, moolaPool, input, 24n);
  const pFee = protocolFee(valueOut);
  const valueIn = priceFromTargetOutput(valueOut, moolaPool, bucksPool, 24n);
  t.deepEqual(pricer.getPriceGivenAvailableInput(bucks(input), moolaBrand), {
    amountIn: bucks(valueIn),
    amountOut: moola(valueOut - pFee),
    protocolFee: moola(pFee),
  });
  t.truthy(
    (moolaPool - valueOut) * (bucksPool + valueIn) > bucksPool * moolaPool,
  );
});