# GLOBAL — BNB Testnet contract

قرارداد، تست‌ها و نصب اوبونتو برای پروژه GLOBAL. [راهنمای کامل فارسی](README.fa.md)

## Ubuntu

پس از clone مخزن و ورود به پوشه پروژه:

```bash
sudo apt-get update
sudo apt-get install -y curl ca-certificates xz-utils
bash ubuntu-setup.sh
```

آدرس `TEST-ONLY DEPLOYER` را فقط با tBNB آزمایشی تأمین کنید و سپس:

```bash
bash ubuntu-testnet.sh deploy
```

این مسیر توکن و منابع قیمت ساختگی برای BNB Testnet ایجاد می‌کند و برای پول واقعی نیست. مالک، هفت شریک و مقصد عملیاتی در `config.example.json` ثبت شده‌اند. کیف پول پرداخت‌کننده فقط روی سرور ساخته می‌شود. فایل‌های کلید، تنظیمات محرمانه، journal و runtime با `.gitignore` از Git کنار گذاشته شده‌اند. فقط گزارش `deployment-public.json` را به اشتراک بگذارید.

## Validation

43 contract tests passed locally; an additional local integration test covers the server deployer, ownership, chain restriction and resume behavior. Public-chain deployment has not been performed by this package's author. No independent audit has been completed.

## نصب مستقیم از گیت‌هاب

```bash
git clone https://github.com/Rezamoradifar/Gloucestershire.git ~/global-bnb
cd ~/global-bnb
bash ubuntu-setup.sh
# پس از تأمین tBNB کیف پول تست:
bash ubuntu-testnet.sh deploy
```

به‌روزرسانی نسخه، پس از بررسی تغییرات:

```bash
cd ~/global-bnb
git pull --ff-only
bash ubuntu-setup.sh
```

اجرای مجدد setup کلید موجود کیف پول تست را عوض نمی‌کند. با اجرای deploy رسیدهای قبلی بررسی می‌شوند؛ با تغییر تنظیمات سازنده، ادامه استقرار متوقف می‌شود.

`deployment-console/` صفحه استقرار مرورگری SafePal است؛ روی HTTPS میزبانی کنید. این صفحه با کیف پول مالک چهار تراکنش تستی می‌سازد و جایگزین روش سرور است. در روش سرور، کیف پول تست مستقل کارمزد را می‌پردازد. قرارداد فرانت تجاری و اجرای API دراپ‌شیپینگ را شامل نمی‌شود.
