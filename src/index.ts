import { join } from 'path';
import puppeteer from 'puppeteer';
import dotenv from 'dotenv';
import delay from 'delay';
import * as Sentry from '@sentry/node';
import pino from 'pino';
import { createWriteStream } from 'pino-logflare';

dotenv.config({ path: join(__dirname, '/../.env') });

Sentry.init({
  dsn: process.env.SENTRY_DSN,
});

const stream = process.env.LOGFLARE_KEY
  ? createWriteStream({
      sourceToken: process.env.LOGFLARE_SOURCE,
      apiKey: process.env.LOGFLARE_KEY,
    })
  : undefined;
const logger = pino({}, stream ? stream : undefined);

const username = process.env.SF_USERNAME;
const password = process.env.SF_PASSWORD;

const startTime = new Date();
const browserPromise = puppeteer.launch({ headless: true });

async function clipCoupons() {
  const browser = await browserPromise;
  const page = await browser.newPage();
  await page.goto('https://www.safeway.com/account/sign-in.html?goto=/justforu/coupons-deals.html');
  await page.waitForSelector('#btnSignIn');
  await page.type('input#label-email[type="text"]', username);
  await page.type('input#label-password[type="password"]', password);
  await page.click('#btnSignIn');
  await page.waitForSelector('.load-more');

  let max = 100;
  while ((await page.$('.load-more')) !== null) {
    max -= 1;
    await page.click('.load-more');
    await delay(200);

    if (max === 0) {
      throw new Error('Hit max load-more');
    }
  }

  const allUnclippedCouponButtons = await page.$$('.grid-coupon-btn:not([disabled])');
  const couponCount = allUnclippedCouponButtons.length;

  max = allUnclippedCouponButtons.length + 5;
  while ((await page.$('.grid-coupon-btn:not([disabled])')) !== null) {
    max -= 1;
    await page.click('.grid-coupon-btn:not([disabled])');
    await delay(200);

    if (max === 0) {
      throw new Error('Hit max clips');
    }
  }

  await browser.close();
  return couponCount;
}

if (require.main === module) {
  clipCoupons()
    .then(couponCount => {
      console.log('success');
      const message = `success ${couponCount} clipped`;
      logger.info(
        {
          name: 'safeway-jfu',
          startTime: startTime.toISOString(),
          endTime: new Date().toISOString(),
          isSuccess: true,
          msg: message,
        },
        message,
      );
    })
    .catch(async (err: Error) => {
      Sentry.captureException(err);
      const message = `failed ${err.message}`;
      logger.info(
        {
          name: 'safeway-jfu',
          startTime: startTime.toISOString(),
          endTime: new Date().toISOString(),
          isSuccess: false,
          msg: message,
        },
        message,
      );
      logger.flush();
      await Sentry.flush();
      await (await browserPromise).close();
      await delay(800);
      process.exit(1);
    })
    .then(async () => {
      logger.flush();
      await delay(800);
      process.exit(0);
    });
}
