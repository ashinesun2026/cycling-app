import urllib.request
import urllib.parse
import json
import time
import re
import ssl

ssl._create_default_https_context = ssl._create_unverified_context

def make_request(url, data=None, method=None, content_type=None, cookie=None):
    headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml,application/json;q=0.9,image/webp,*/*;q=0.8'
    }
    if content_type:
        headers['Content-Type'] = content_type
    if cookie:
        headers['Cookie'] = cookie
    
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req) as response:
        headers_info = response.info()
        set_cookie = headers_info.get('Set-Cookie', None)
        return response.getcode(), response.read().decode(), set_cookie

def unwrap_kvdb_tracking_link(link):
    """Postmark wraps KVdb links. Extract the real kvdb.io/login?token=... URL."""
    link = link.replace("&amp;", "&")
    parsed = urllib.parse.urlparse(link)

    if parsed.netloc == "kvdb.io" and parsed.path.startswith("/login"):
        return link

    if parsed.netloc != "track.pstmrk.it":
        return None

    parts = parsed.path.split("/")
    if len(parts) < 3 or parts[1] != "3s":
        return None

    target = urllib.parse.unquote(parts[2])
    if target.startswith("kvdb.io/login?token="):
        return f"https://{target}"
    return None

def main():
    print("=== Automated kvdb.io Bucket Creator and Verifier using Guerrilla Mail ===")
    
    # 1. Get email address from Guerrilla Mail
    print("Generating temporary email from Guerrilla Mail...")
    try:
        url = "https://www.guerrillamail.com/ajax.php?f=get_email_address"
        code, body, set_cookie = make_request(url)
        data = json.loads(body)
    except Exception as e:
        print(f"Error generating email: {e}")
        return
    
    email = data["email_addr"]
    sid_token = data["sid_token"]
    # We must preserve the cookie or pass the sid_token in query params
    guerrilla_cookie = set_cookie.split(';')[0] if set_cookie else f"PHPSESSID={sid_token}"
    print(f"Generated Email: {email}")

    # 2. Register bucket on kvdb.io
    print("Registering new bucket on kvdb.io...")
    post_data = urllib.parse.urlencode({"email": email}).encode()
    
    try:
        code, bucket_id, kvdb_set_cookie = make_request("https://kvdb.io/", data=post_data, content_type="application/x-www-form-urlencoded")
        bucket_id = bucket_id.strip()
        kvdb_cookie = kvdb_set_cookie.split(';')[0] if kvdb_set_cookie else None
        print(f"Bucket registered. Bucket ID: {bucket_id}")
        print(f"KVdb Cookie: {kvdb_cookie}")
    except Exception as e:
        print(f"Error registering bucket: {e}")
        return

    # 3. Poll for verification email
    print("Waiting for verification email (polling every 5 seconds, max 2 minutes)...")
    email_id = None
    for attempt in range(24):
        time.sleep(5)
        print(f"Checking inbox (attempt {attempt + 1}/24)...")
        list_url = f"https://www.guerrillamail.com/ajax.php?f=check_email&seq=0&sid_token={sid_token}"
        try:
            code, body, _ = make_request(list_url, cookie=guerrilla_cookie)
            inbox_data = json.loads(body)
            messages = inbox_data.get("list", [])
                
            for msg in messages:
                sender = msg.get("mail_from", "").lower()
                subject = msg.get("mail_subject", "").lower()
                if "kvdb" in sender or "verify" in subject or "activation" in subject:
                    email_id = msg["mail_id"]
                    print(f"Found verification email! Email ID: {email_id}")
                    break
        except Exception as e:
            print(f"Error checking inbox: {e}")
            
        if email_id:
            break
    else:
        print("Verification email did not arrive in 2 minutes.")
        return

    # 4. Fetch email body and extract verification link
    print(f"Fetching email body for email ID: {email_id}...")
    read_url = f"https://www.guerrillamail.com/ajax.php?f=fetch_email&email_id={email_id}&sid_token={sid_token}"
    try:
        code, body, _ = make_request(read_url, cookie=guerrilla_cookie)
        email_data = json.loads(body)
            
        email_body = email_data.get("mail_body", "")
        links = re.findall(r'href=[\'"]?([^\'" >]+)', email_body)
        text_links = re.findall(r'(https?://[^\s>]+)', email_body)
        verify_link = None
        for link in [*links, *text_links]:
            unwrapped = unwrap_kvdb_tracking_link(link)
            if unwrapped:
                verify_link = unwrapped
                break
                
        if not verify_link:
            for link in [*links, *text_links]:
                if "login?token=" in link and "kvdb.io" in link:
                    verify_link = link.replace("&amp;", "&")
                    break
                    
        if not verify_link:
            print("Could not find KVdb login token link in email body.")
            return

        print(f"Found Verification Link: {verify_link}")
    except Exception as e:
        print(f"Error reading email: {e}")
        return

    # 5. Click verification link WITH THE KVDB COOKIE
    print("Clicking verification link with KVdb session cookie to activate bucket...")
    try:
        code, html, _ = make_request(verify_link, cookie=kvdb_cookie)
        print(f"Activation request sent. Response status: {code}")
    except Exception as e:
        print(f"Error clicking verification link: {e}")

    # 6. Test writing to the bucket to verify it's working
    print("Testing write operation on the verified bucket...")
    test_url = f"https://kvdb.io/{bucket_id}/sync_test_key?ttl=60"
    test_data = json.dumps({"status": "verified"}).encode()
    
    try:
        code, res_body, _ = make_request(test_url, data=test_data, content_type="application/json", method="POST")
        print(f"Write test completed. HTTP status: {code}, response: {res_body}")
        if code in [200, 201]:
            print("\n🎉 SUCCESS! Bucket is fully verified and working!")
            print(f"Verified Bucket ID: {bucket_id}")
        else:
            print(f"\n❌ FAILED. Got status {code}")
    except Exception as e:
        print(f"\n❌ Write test failed: {e}")
        if hasattr(e, 'read'):
            print(f"Server response: {e.read().decode()}")

if __name__ == "__main__":
    main()
