// @vitest-environment jsdom
import '../chat/testing/setup.ts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithServices } from '../chat/testing/render.tsx';
import { createFakeServices } from '../testing/fakeServices.ts';
import { ISSUES_NEW_URL, REPORT_PROBLEM_TID, ReportProblem, issueBody, issueUrl, whereText, type ReportFacts } from './ReportProblem.tsx';

const UA = 'Mozilla/5.0 (Linux; Android 11; P80X) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36';

const TABLET: ReportFacts = {
  appVersion: '0.1.3',
  decaidVersion: '0.9.0',
  host: { insideDecaid: true, platform: 'android' },
  userAgent: UA,
  logShares: false,
};

const PRIVACY = 'It holds your chat with the coach, so take out anything you would rather not post.';

afterEach(() => {
  vi.unstubAllGlobals();
  delete (document as { execCommand?: unknown }).execCommand;
});

describe('the new issue (D248)', () => {
  it("holds CafAI's and Decaid's versions, where CafAI runs and a reminder to attach the log, under room for what happened", () => {
    expect(issueBody(TABLET)).toBe(
      [
        'What happened:',
        '',
        '',
        'CafAI: 0.1.3',
        'Decaid: 0.9.0',
        'Where: inside Decaid on Android',
        `Browser: ${UA}`,
        '',
        `Attach the log: Settings > Data and privacy > Log > Copy, then paste it here. ${PRIVACY}`,
      ].join('\n'),
    );
  });

  it("names the log's Share where this device has it", () => {
    expect(issueBody({ ...TABLET, logShares: true })).toContain(`Attach the log: Settings > Data and privacy > Log > Share. ${PRIVACY}`);
  });

  it("says when Decaid's version is not known", () => {
    expect(issueBody({ ...TABLET, decaidVersion: null })).toContain('\nDecaid: version unknown\n');
  });

  it("is GitHub's new issue page for CafAI, the title empty and the body filled in", () => {
    const url = issueUrl(TABLET);
    expect(ISSUES_NEW_URL).toBe('https://github.com/justinmwarner/CafAI/issues/new');
    expect(url.startsWith(`${ISSUES_NEW_URL}?title=&body=`)).toBe(true);
    const query = new URL(url).searchParams;
    expect(query.get('title')).toBe('');
    expect(query.get('body')).toBe(issueBody(TABLET));
  });

  it('says where CafAI runs: inside Decaid on its platform, or in a browser', () => {
    expect(whereText({ insideDecaid: true, platform: 'android' })).toBe('inside Decaid on Android');
    expect(whereText({ insideDecaid: true, platform: 'ios' })).toBe('inside Decaid on iOS');
    expect(whereText({ insideDecaid: true, platform: 'macos' })).toBe('inside Decaid on macOS');
    expect(whereText({ insideDecaid: true, platform: 'windows' })).toBe('inside Decaid on Windows');
    expect(whereText({ insideDecaid: true, platform: 'linux' })).toBe('inside Decaid on Linux');
    expect(whereText({ insideDecaid: true, platform: 'fuchsia' })).toBe('inside Decaid on fuchsia');
    expect(whereText({ insideDecaid: true, platform: null })).toBe('inside Decaid');
    expect(whereText({ insideDecaid: false, platform: null })).toBe('in a browser');
  });
});

describe('ReportProblem (D248)', () => {
  it("in a browser opens the new issue in a new tab, with Decaid's version once Decaid answers", async () => {
    const services = createFakeServices();
    renderWithServices(<ReportProblem />, services);
    const link = screen.getByTestId(REPORT_PROBLEM_TID.reportProblem);
    expect(link).toHaveTextContent('Report a problem');
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    const expected = issueUrl({
      appVersion: '0.1.0-test',
      decaidVersion: '0.9.0+1',
      host: { insideDecaid: false, platform: null },
      userAgent: navigator.userAgent,
      logShares: false,
    });
    await waitFor(() => expect(link).toHaveAttribute('href', expected));
    expect(screen.getByText(/^Opens GitHub's new issue page with CafAI's and Decaid's versions filled in\./)).toBeInTheDocument();
    // A link that opens is enough here: no address to copy.
    expect(screen.queryByTestId(REPORT_PROBLEM_TID.reportProblemAddress)).toBeNull();
    expect(screen.queryByTestId(REPORT_PROBLEM_TID.reportProblemCopy)).toBeNull();
  });

  it("names the log's Share in the issue where the browser can share", async () => {
    vi.stubGlobal('navigator', { ...navigator, userAgent: navigator.userAgent, share: vi.fn() });
    renderWithServices(<ReportProblem />, createFakeServices());
    const link = screen.getByTestId(REPORT_PROBLEM_TID.reportProblem);
    await waitFor(() => expect(link.getAttribute('href')).toContain(encodeURIComponent('Log > Share.')));
  });

  it('inside Decaid is a plain link, which Decaid opens in the browser, and shows its address with Copy', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...navigator, userAgent: navigator.userAgent, clipboard: { writeText } });
    renderWithServices(<ReportProblem />, createFakeServices({ insideDecaid: true }));
    const link = screen.getByTestId(REPORT_PROBLEM_TID.reportProblem);
    expect(link).not.toHaveAttribute('target');
    const expected = issueUrl({
      appVersion: '0.1.0-test',
      decaidVersion: '0.9.0',
      host: { insideDecaid: true, platform: 'android' },
      userAgent: navigator.userAgent,
      logShares: false,
    });
    expect(link).toHaveAttribute('href', expected);
    expect(screen.getByText('If GitHub does not open, copy the address into a browser.')).toBeInTheDocument();
    const address = screen.getByTestId(REPORT_PROBLEM_TID.reportProblemAddress);
    expect(address).toHaveValue(expected);
    expect(address).toHaveAttribute('readonly');
    expect(address).toHaveAccessibleName('Address of the new issue');

    await userEvent.click(screen.getByTestId(REPORT_PROBLEM_TID.reportProblemCopy));
    expect(writeText).toHaveBeenCalledWith(expected);
    expect(await screen.findByTestId(REPORT_PROBLEM_TID.reportProblemSaid)).toHaveTextContent('Copied.');
  });

  it('says how to copy by hand when copying fails inside Decaid', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      userAgent: navigator.userAgent,
      clipboard: { writeText: vi.fn(async () => Promise.reject(new Error('Denied'))) },
    });
    Object.defineProperty(document, 'execCommand', { value: vi.fn(() => false), configurable: true });
    renderWithServices(<ReportProblem />, createFakeServices({ insideDecaid: true }));
    await userEvent.click(screen.getByTestId(REPORT_PROBLEM_TID.reportProblemCopy));
    const said = await screen.findByTestId(REPORT_PROBLEM_TID.reportProblemSaid);
    expect(said).toHaveTextContent('Copying failed. Tap the address, select all, then copy.');
    expect(said).toHaveAttribute('role', 'status');
  });
});
