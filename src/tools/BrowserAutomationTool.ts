import { Tool, ToolResult } from '../gateway/types';
import { logger } from '../logger';
import { config } from '../config';

// Playwright types - we'll import dynamically
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Browser = any;
type Page = any;

export class BrowserAutomationTool implements Tool {
  name = 'browser_automate';
  description = `Browser automation for web scraping, screenshots, and interaction. Uses Playwright with system Chromium (Termux compatible).
Actions:
- navigate: Load a URL
- screenshot: Capture page as image (base64 or save to path)
- click: Click an element by selector
- type: Type text into an input field
- extract: Extract text content or HTML from page/elements
- pdf: Generate PDF of page (desktop only)
- scroll: Scroll page down/up`;

  parameters = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['navigate', 'screenshot', 'click', 'type', 'extract', 'pdf', 'scroll'],
        description: 'Browser action to perform',
      },
      url: {
        type: 'string',
        description: 'URL to navigate to (required for navigate)',
      },
      selector: {
        type: 'string',
        description: 'CSS selector for click, type, or extract actions',
      },
      text: {
        type: 'string',
        description: 'Text to type (required for type action)',
      },
      path: {
        type: 'string',
        description: 'File path to save screenshot or PDF (optional, defaults to base64/data URL)',
      },
      format: {
        type: 'string',
        enum: ['text', 'html', 'markdown'],
        description: 'Extract format (default: text)',
      },
      waitFor: {
        type: 'string',
        description: 'CSS selector to wait for before performing action',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds (default: 30000)',
      },
      viewport: {
        type: 'object',
        description: 'Viewport size {width, height}',
        properties: {
          width: { type: 'number', default: 1280 },
          height: { type: 'number', default: 720 },
        },
      },
      headless: {
        type: 'boolean',
        description: 'Run in headless mode (default: true)',
        default: true,
      },
    },
    required: ['action'],
  };

  private chromiumPath: string | undefined;
  private browser: Browser | null = null;
  private page: Page | null = null;

  constructor() {
    // Check for Termux Chromium path
    this.chromiumPath = process.env.CHROMIUM_PATH;
    if (this.chromiumPath) {
      logger.info(`BrowserAutomationTool: Using Chromium at ${this.chromiumPath}`);
    }
  }

  private async getPlaywright() {
    try {
      // Try playwright-core first (lighter, no browser downloads)
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      return require('playwright-core');
    } catch {
      // Fall back to full playwright
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      return require('playwright');
    }
  }

  private async launchBrowser(headless: boolean, viewport?: { width: number; height: number }) {
    const playwright = await this.getPlaywright();
    const launchOptions: { headless: boolean; args: string[]; executablePath?: string } = {
      headless,
      args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    };

    // Use system Chromium if available (Termux mode)
    if (this.chromiumPath) {
      launchOptions.executablePath = this.chromiumPath;
    }

    // Check if running on ARM/Termux and adjust accordingly
    if (process.arch === 'arm64' || process.arch === 'arm') {
      launchOptions.args.push('--disable-features=VizDisplayCompositor');
    }

    this.browser = await playwright.chromium.launch(launchOptions);

    this.page = await this.browser.newPage();
    if (viewport) {
      await this.page.setViewportSize(viewport);
    } else {
      await this.page.setViewportSize({ width: 1280, height: 720 });
    }

    return { browser: this.browser, page: this.page };
  }

  private async closeBrowser() {
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
      this.page = null;
    }
  }

  async execute(params: {
    action: string;
    url?: string;
    selector?: string;
    text?: string;
    path?: string;
    format?: 'text' | 'html' | 'markdown';
    waitFor?: string;
    timeout?: number;
    viewport?: { width: number; height: number };
    headless?: boolean;
  }): Promise<ToolResult> {
    const {
      action,
      url,
      selector,
      text,
      path,
      format = 'text',
      waitFor,
      timeout = 30000,
      viewport,
      headless = true,
    } = params;

    logger.info(`BrowserAutomationTool: ${action}`, { url, selector });

    try {
      switch (action) {
        case 'navigate':
          return await this.handleNavigate(url, waitFor, timeout, headless, viewport);
        case 'screenshot':
          return await this.handleScreenshot(path, selector, headless, viewport);
        case 'click':
          return await this.handleClick(selector, waitFor, timeout, headless, viewport);
        case 'type':
          return await this.handleType(selector, text, waitFor, timeout, headless, viewport);
        case 'extract':
          return await this.handleExtract(selector, format, headless, viewport);
        case 'pdf':
          return await this.handlePdf(path, headless, viewport);
        case 'scroll':
          return await this.handleScroll(headless, viewport);
        default:
          return { success: false, error: `Unknown action: ${action}` };
      }
    } catch (error: any) {
      logger.error(`BrowserAutomationTool error: ${error.message}`);
      await this.closeBrowser();
      return { success: false, error: error.message };
    }
  }

  private async handleNavigate(
    url?: string,
    waitFor?: string,
    timeout = 30000,
    headless = true,
    viewport?: { width: number; height: number }
  ): Promise<ToolResult> {
    if (!url) {
      return { success: false, error: 'URL is required for navigate action' };
    }

    const { page } = await this.launchBrowser(headless, viewport);

    await page.goto(url, { waitUntil: 'networkidle', timeout });

    if (waitFor) {
      await page.waitForSelector(waitFor, { timeout });
    }

    const title = await page.title();
    const finalUrl = page.url();

    await this.closeBrowser();

    return {
      success: true,
      data: {
        title,
        url: finalUrl,
        message: `Navigated to ${finalUrl}`,
      },
    };
  }

  private async handleScreenshot(
    path?: string,
    selector?: string,
    headless = true,
    viewport?: { width: number; height: number }
  ): Promise<ToolResult> {
    if (!this.page) {
      return { success: false, error: 'No page loaded. Use navigate first or provide URL.' };
    }

    let screenshotBuffer: Buffer;

    if (selector) {
      const element = await this.page.$(selector);
      if (!element) {
        await this.closeBrowser();
        return { success: false, error: `Element not found: ${selector}` };
      }
      screenshotBuffer = await element.screenshot();
    } else {
      screenshotBuffer = await this.page.screenshot({ fullPage: true });
    }

    await this.closeBrowser();

    if (path) {
      const fs = require('fs');
      fs.writeFileSync(path, screenshotBuffer);
      return {
        success: true,
        data: {
          path,
          size: screenshotBuffer.length,
          message: `Screenshot saved to ${path}`,
        },
      };
    } else {
      // Return as base64 for display
      const base64 = screenshotBuffer.toString('base64');
      return {
        success: true,
        data: {
          base64,
          size: screenshotBuffer.length,
          dataUrl: `data:image/png;base64,${base64}`,
          message: 'Screenshot captured (base64)',
        },
      };
    }
  }

  private async handleClick(
    selector?: string,
    waitFor?: string,
    timeout = 30000,
    headless = true,
    viewport?: { width: number; height: number }
  ): Promise<ToolResult> {
    if (!selector) {
      return { success: false, error: 'Selector is required for click action' };
    }

    if (!this.page) {
      return { success: false, error: 'No page loaded. Use navigate first.' };
    }

    await this.page.click(selector);

    if (waitFor) {
      await this.page.waitForSelector(waitFor, { timeout });
    }

    // Wait a bit for navigation or state change
    await this.page.waitForLoadState('networkidle').catch(() => {});

    const url = this.page.url();

    return {
      success: true,
      data: {
        url,
        clicked: selector,
        message: `Clicked ${selector}`,
      },
    };
  }

  private async handleType(
    selector?: string,
    text?: string,
    waitFor?: string,
    timeout = 30000,
    headless = true,
    viewport?: { width: number; height: number }
  ): Promise<ToolResult> {
    if (!selector || text === undefined) {
      return { success: false, error: 'Selector and text are required for type action' };
    }

    if (!this.page) {
      return { success: false, error: 'No page loaded. Use navigate first.' };
    }

    await this.page.fill(selector, text);

    if (waitFor) {
      await this.page.waitForSelector(waitFor, { timeout });
    }

    return {
      success: true,
      data: {
        selector,
        text: text.substring(0, 50) + (text.length > 50 ? '...' : ''),
        message: `Typed text into ${selector}`,
      },
    };
  }

  private async handleExtract(
    selector?: string,
    format: 'text' | 'html' | 'markdown' = 'text',
    headless = true,
    viewport?: { width: number; height: number }
  ): Promise<ToolResult> {
    if (!this.page) {
      return { success: false, error: 'No page loaded. Use navigate first.' };
    }

    let content: string;

    if (selector) {
      const element = await this.page.$(selector);
      if (!element) {
        await this.closeBrowser();
        return { success: false, error: `Element not found: ${selector}` };
      }

      if (format === 'html') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        content = await element.evaluate((el: any) => el.outerHTML);
      } else if (format === 'markdown') {
        // Simple HTML to markdown conversion
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const html = await element.evaluate((el: any) => el.innerHTML);
        content = this.simpleHtmlToMarkdown(html);
      } else {
        content = await element.textContent() || '';
      }
    } else {
      // Extract from whole page
      if (format === 'html') {
        content = await this.page.content();
      } else if (format === 'markdown') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const html = await this.page.evaluate(() => (globalThis as any).document.body.innerHTML);
        content = this.simpleHtmlToMarkdown(html);
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        content = await this.page.evaluate(() => (globalThis as any).document.body.innerText || '');
      }
    }

    // Truncate if too long
    const maxLength = 50000;
    const truncated = content.length > maxLength;
    const finalContent = truncated ? content.substring(0, maxLength) + '\n...[truncated]' : content;

    await this.closeBrowser();

    return {
      success: true,
      data: {
        content: finalContent,
        length: content.length,
        truncated,
        format,
        selector: selector || 'full page',
      },
    };
  }

  private async handlePdf(
    path?: string,
    headless = true,
    viewport?: { width: number; height: number }
  ): Promise<ToolResult> {
    if (!this.page) {
      return { success: false, error: 'No page loaded. Use navigate first.' };
    }

    // PDF doesn't work well on Termux/ARM, warn about it
    if (process.arch === 'arm64' || process.arch === 'arm') {
      logger.warn('PDF generation may not work on ARM/Termux devices');
    }

    const pdfPath = path || `/tmp/superclaw_${Date.now()}.pdf`;

    try {
      await this.page.pdf({
        path: pdfPath,
        format: 'A4',
        printBackground: true,
      });

      await this.closeBrowser();

      return {
        success: true,
        data: {
          path: pdfPath,
          message: `PDF saved to ${pdfPath}`,
        },
      };
    } catch (error: any) {
      await this.closeBrowser();
      return {
        success: false,
        error: `PDF generation failed: ${error.message}. Note: PDF may not work on Termux/ARM.`,
      };
    }
  }

  private async handleScroll(
    headless = true,
    viewport?: { width: number; height: number }
  ): Promise<ToolResult> {
    if (!this.page) {
      return { success: false, error: 'No page loaded. Use navigate first.' };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await this.page.evaluate(() => {
      (globalThis as any).window.scrollBy(0, (globalThis as any).window.innerHeight);
    });

    // Get new scroll position
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const scrollInfo = await this.page.evaluate(() => ({
      scrollY: (globalThis as any).window.scrollY,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      scrollHeight: (globalThis as any).document.body.scrollHeight,
      viewportHeight: (globalThis as any).window.innerHeight,
    }));

    return {
      success: true,
      data: {
        scrolledTo: scrollInfo.scrollY,
        totalHeight: scrollInfo.scrollHeight,
        progress: `${Math.round((scrollInfo.scrollY / scrollInfo.scrollHeight) * 100)}%`,
      },
    };
  }

  private simpleHtmlToMarkdown(html: string): string {
    return html
      .replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n\n')
      .replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n\n')
      .replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n\n')
      .replace(/<h4[^>]*>(.*?)<\/h4>/gi, '#### $1\n\n')
      .replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**')
      .replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**')
      .replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*')
      .replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*')
      .replace(/<a[^>]+href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)')
      .replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
}

export const browserAutomationTool = new BrowserAutomationTool();
export default browserAutomationTool;
