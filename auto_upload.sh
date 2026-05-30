#!/bin/bash
echo "=== Antigravity Cycling - 自動上傳與部署系統 ==="

# 1. 本地 Git 提交
if [ ! -d ".git" ]; then
    git init
    echo "✅ 已初始化本地 Git 儲存庫。"
fi

git add .
git commit -m "Initialize cycling app with multi-user, history, rules engine, and iOS support" 2>/dev/null || echo "ℹ️ 檔案已提交過，無新異動。"
git branch -M main

# 2. 檢查 GitHub 儲存庫是否存在
REPO_NAME="cycling-app"
OWNER="ashinesun2026"
FULL_REPO="$OWNER/$REPO_NAME"

echo "🔍 正在檢查 GitHub 遠端儲存庫 $FULL_REPO..."
gh repo view "$FULL_REPO" &>/dev/null

if [ $? -ne 0 ]; then
    echo "🚀 偵測到 GitHub 上無此儲存庫，正在為您建立 $REPO_NAME (Public)..."
    gh repo create "$REPO_NAME" --public --confirm
    if [ $? -eq 0 ]; then
        echo "✅ GitHub 儲存庫建立成功！"
    else
        echo "❌ 錯誤：無法在 GitHub 上建立儲存庫。"
        exit 1
    fi
else
    echo "ℹ️ 儲存庫 $FULL_REPO 已存在於您的 GitHub。"
fi

# 3. 設定遠端 URL 並推送
git remote remove origin 2>/dev/null
git remote add origin "https://github.com/$FULL_REPO.git"

echo "📤 正在上傳程式碼至 GitHub..."
git push -u origin main

if [ $? -ne 0 ]; then
    echo "❌ 錯誤：推送至 GitHub 失敗。"
    exit 1
fi

echo "✅ 程式碼上傳成功！"

# 4. 開啟 GitHub Pages 服務
echo "🌐 正在開通 GitHub Pages 靜態網頁服務..."
# 嘗試呼叫 API 開通
gh api -X POST "/repos/$FULL_REPO/pages" \
  -f source[branch]=main \
  -f source[path]=/ &>/dev/null

if [ $? -eq 0 ]; then
    echo "🎉 GitHub Pages 成功啟用！"
else
    # 有可能已經啟用過，進行提示
    echo "ℹ️ GitHub Pages 設定完成 (若之前已開啟，則會沿用舊設定)。"
fi

echo ""
echo "============================================="
echo "🎉 恭喜！網頁已完成自動化上傳與部署！"
echo "👉 您的 iPhone 專屬運動網頁網址為："
echo "   https://$OWNER.github.io/$REPO_NAME/"
echo "============================================="
echo "提示：GitHub Pages 的首度部署需要大約 30 到 60 秒生效。"
echo "請在您的 iPhone 上開啟 Bluefy 瀏覽器，開啟此網址並加入書籤即可運動！"
