# Quick Glimpse — Plain-English Staff Guide

This guide is for clinic and reception staff who use Quick Glimpse day-to-day. No technical knowledge is required.

---

## What is Quick Glimpse?

Quick Glimpse is a digital feedback kiosk. Visitors tap through a short survey on a touchscreen (or tablet) near your reception area. Their anonymous answers help your team understand who is visiting and how they feel about their experience.

---

## Using the kiosk

### How a visitor uses the kiosk

1. The kiosk screen shows a welcome message when it is active.
2. The visitor taps **Start** to begin.
3. They answer a few short questions — multiple choice, star ratings, or brief text.
4. At the end they provide optional demographic information (see [Privacy note](#privacy-note) below).
5. They tap **Done**. Their answers are saved automatically.

The whole survey takes about one to two minutes.

### If the kiosk shows "Kiosk is not available"

Kiosk mode has been switched off. Contact your institution admin (or whoever manages Quick Glimpse for your site) to turn it back on.

### If questions are missing at certain times

Some questions are scheduled to appear only on specific days or during certain hours. This is normal — the survey adjusts to match your operating schedule.

---

## Viewing analytics (for admins)

1. Open `http://your-site-address` and sign in with your admin account.
2. Click **Analytics** in the left menu.
3. Use the **date range** picker to choose a period.
4. Each question shows a summary chart of how visitors responded.

### Cross-tabulation

Cross-tabulation lets you compare responses across visitor groups. For example: "How did satisfaction scores differ between morning and afternoon visitors?"

1. On the Analytics page, click **Cross-tab**.
2. Choose a **primary question** (e.g. "How would you rate your experience?").
3. Choose a **demographic group** (e.g. "Time of visit" or "Age range").
4. The table shows response counts broken down by that demographic group.

---

## Managing questions (for institution admins)

### Turning a question on or off

1. Sign in and go to **Questions**.
2. Find the question you want to change.
3. Toggle the **Show in kiosk** switch.

### Changing the order questions appear

On the **Questions** page, drag questions up or down to change the order visitors see them.

### Scheduling a question for specific days or times

1. Click the pencil icon next to a question.
2. Under **Schedule**, tick the days of the week you want it to appear.
3. Optionally set a **start time** and **end time** (24-hour format, e.g. `09:00` to `17:00`).
4. Save. The question will only appear during those windows.

### Adding a custom question

1. Go to **Questions → Add question**.
2. Choose the question type:
   - **Single choice** — visitor picks one option from a list.
   - **Multiple choice** — visitor picks one or more options.
   - **Star rating** — 1–5 stars.
   - **Scale** — numeric scale.
   - **Yes/No** — simple boolean.
   - **Free text** — visitor types a short response.
3. Type the question text and any answer options.
4. Click **Save**.

The new question appears at the bottom of the list. Drag it to reorder.

### Removing a question

Custom questions can be deleted from the **Questions** page. Built-in template questions can be hidden (toggled off) but not deleted.

---

## What is the demographics data?

At the end of each kiosk session, visitors are asked a few optional demographic questions. Examples include age range, visit reason, or time of day. This information is used to:

- Understand which visitor groups are engaging with feedback.
- Break down satisfaction scores by visitor type in cross-tabulation reports.
- Help your team identify whether experiences differ across different groups.

Demographic answers are stored alongside the survey responses and appear in analytics.

---

## Privacy note

**Quick Glimpse does not collect any personally identifiable information (PII).**

- Visitors are not asked for their name, date of birth, contact details, or any information that could identify them.
- Demographic questions use ranges or categories (e.g. "18–34" or "General enquiry"), never specific personal details.
- Each kiosk session is assigned a random anonymous token — there is no way to trace a session back to a specific individual.
- No data is shared with third parties.

If your organisation has specific data-handling policies, confirm with your data protection officer that Quick Glimpse's collection scope is compatible with those policies.

---

## Account management (for admins)

### Signing in

Go to your Quick Glimpse URL and enter your email and password. If your account has **two-factor authentication (2FA)** enabled, you will be asked to enter a one-time code sent to your email.

### Changing your password

1. Click your name or **Profile** in the top right.
2. Click **Change password**.
3. Enter your current password and then your new password (minimum 10 characters).

### Forgotten password

On the login page, click **Forgot password** and enter your email address. You will receive a password-reset link. The link expires after 15 minutes.

### Magic link sign-in

Instead of a password, you can request a **magic link** from the login page. Click the link in the email you receive and you will be signed in automatically. Magic links are single-use and expire after 15 minutes.

---

## Getting help

For technical issues (server errors, email failures, Docker problems) refer to the [Troubleshooting guide](troubleshooting.md).

For deployment and infrastructure questions refer to the [Installation guide](install.md) or [Production hardening](production-hardening.md).
