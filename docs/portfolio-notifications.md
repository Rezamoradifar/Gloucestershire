# Portfolio notifications and Telegram

Members can read published announcements without connecting a wallet. The dashboard bell opens their signed inbox for public announcements and changes to their own support tickets. Managers receive incoming support activity in the admin inbox. Both inboxes refresh while visible. Read status follows the signed wallet, portfolio and inbox.

## Connect the primary portfolio

1. Create a dedicated Global bot in Telegram using @BotFather. Keep its token on the server.
2. From the owner's Telegram account, create the announcement channel. The suggested name is **Global Drop Trade | Updates**. Use the description in **Admin panel → Announcements → Channel profile and starter posts**. Add the bot as a channel administrator with permission to post messages.
3. Install the website and API release on the primary portfolio host. Run the following command as root in an interactive terminal.

   ```sh
   python3 /opt/globaldroptrade-api/current/scripts/configure-portfolio-telegram.py
   ```

4. Enter the token at the hidden prompt. For the private recipient, enter the administrator's numeric chat ID or their Telegram username. When pairing by username, the administrator must open the temporary start link. For an existing private ID, the administrator must have started the bot. The setup prints the verified recipient and channel before saving and sends a private confirmation after activation. A blank channel is supported for private-only setup. Run the same command later to add the channel.
5. In **Admin panel → Announcements**, preview the six starter posts. Publish them together or choose a draft, edit it and publish it individually. Publishing the pack again skips existing posts and queues any published starter posts missing from the configured channel. Pin the welcome post from the owner's channel account.

Published announcements appear on the website immediately. When connected, the bot copies new publications to the channel, applies edits to the same message and replaces withdrawn text with a withdrawal notice. Use **Sync to Telegram** to send an existing published announcement. Private support alerts sent to the administrator include only the event type, ticket ID and dashboard link.

**Admin panel → Notifications & Telegram** shows the configured destinations, queued messages and delivery issues. A rate limit delays delivery automatically. For an interrupted send, check the destination first. Enter the existing message ID if it arrived, or retry after confirming it is missing. Private ticket messages remain in the signed dashboard.
