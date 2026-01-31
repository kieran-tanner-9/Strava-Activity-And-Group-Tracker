# Contributing to Strava Club Stats

First off, thanks for taking the time to contribute! 🎉

This is a **hobby project** maintained by a single developer (with some AI assistance). I welcome contributions from the community, but please bear in mind that my time is limited.

## How Can I Contribute?

### 1. Reporting Bugs
This project is provided "as-is," but if you find a bug, please create a new issue.
* **Search existing issues** to see if it has already been reported.
* **Be specific:** Include steps to reproduce the bug and details about your browser or environment.

### 2. Suggesting Enhancements
Have an idea to make the leaderboard better?
* Open an issue with the tag `enhancement`.
* Explain *why* this change would be useful to other clubs, not just your specific use case.

### 3. Pull Requests
I am happy to review Pull Requests (PRs), but please keep them small and focused.

1.  **Fork** the repository.
2.  **Clone** your fork locally.
3.  Create a new **branch** (`git checkout -b feature/amazing-feature`).
4.  Make your changes.
5.  **Test** your changes locally using `npm run dev`.
6.  Commit your changes (`git commit -m 'Add some amazing feature'`).
7.  Push to the branch (`git push origin feature/amazing-feature`).
8.  Open a **Pull Request**.

## Development Setup

If you want to run the project locally to test your changes:

1.  **Install dependencies:**
    ```bash
    npm install
    ```
2.  **Setup local database:**
    ```bash
    npx wrangler d1 create strava-db
    npx wrangler d1 execute strava-db --local --file=./schema.sql
    ```
3.  **Run the development server:**
    ```bash
    npm run dev
    ```

## Coding Guidelines

* **Type Generation:** If you change the `wrangler.jsonc` configuration or bindings, please run `npm run cf-typegen` to update the TypeScript types.
* **Style:** Try to keep the code style consistent with the existing file. Simple and readable is better than clever.
* **Tailwind:** If you modify `src/input.css`, remember that the build process handles the output.

## Code of Conduct

Please note that this project is released with a [Contributor Code of Conduct](CODE_OF_CONDUCT.md). By participating in this project you agree to abide by its terms.
