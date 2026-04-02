import { ScrapedProfile } from '../types/scraper';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(StealthPlugin());

export async function scrapeWithPuppeteer(url: string): Promise<ScrapedProfile> {
    console.log('Launching Puppeteer...');
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    try {
        console.log(`Navigating to ${url}...`);
        await page.goto(url, { waitUntil: 'networkidle2' });

        console.log('Extracting page content...');
        const content = await page.evaluate(() => {
            const username = document.querySelector('._aacl._aacs._aact._aacx._aada') as HTMLElement | null
            const followers = document.querySelector('a[href$="/followers/"] > span') as HTMLElement | null
            const following = document.querySelector('a[href$="/following/"] > span') as HTMLElement | null
            const postsCount = document.querySelector('span._ac2a') as HTMLElement | null
            const bio = document.querySelector('._aacl._aaco._aacu._aacx._aad6._aade') as HTMLElement | null
            const urlElement = document.querySelector('a._ac2a')
            const posts = Array.from(document.querySelectorAll('._aagw')).map(post => {
                const likes = post.querySelector('._aae_._aady._aaen._aade') as HTMLElement | null
                const comments = Array.from(post.querySelectorAll('._aacl._aaco._aacu._aacx._aad6._aade')).map(comment => ({
                    text: (comment as HTMLElement).innerText
                }));
                const caption = post.querySelector('._aacl._aaco._aacu._aacx._aad6._aade') as HTMLElement | null

                return {
                    likes: likes ? parseInt(likes.innerText) : 0,
                    comments,
                    caption: caption ? caption.innerText : ''
                }
            })

            return {
                username: username ? username.innerText : '',
                followers: followers ? parseInt(followers.title) : 0,
                following: following ? parseInt(following.innerText) : 0,
                postsCount: postsCount ? parseInt(postsCount.innerText) : 0,
                bio: bio ? bio.innerText : '',
                bioLength: bio ? bio.innerText.length : 0,
                urlPresence: !!urlElement,
                isPrivate: !!document.querySelector('._aa_u'),
                profilePictureUrl: document.querySelector('._aadp._aa-6 img')?.src,
                highlightsCount: document.querySelectorAll('._a6y3').length,
                posts
            };
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