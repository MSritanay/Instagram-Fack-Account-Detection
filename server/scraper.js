const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

async function scrapeWithPuppeteer(url) {
    console.log('Launching Puppeteer...');
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    try {
        console.log(`Navigating to ${url}...`);
        await page.goto(url, { waitUntil: 'networkidle2' });

        console.log('Extracting page content...');
        const content = await page.evaluate(() => {
            return document.body.innerText;
        });

        return content;
    } catch (error) {
        console.error('Error during Puppeteer scraping:', error);
        throw new Error('Failed to scrape with Puppeteer.');
    } finally {
        await browser.close();
        console.log('Browser closed.');
    }
}

module.exports = { scrapeWithPuppeteer };