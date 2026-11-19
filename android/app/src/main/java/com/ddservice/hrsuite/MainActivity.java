package com.ddservice.hrsuite;

import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AlertDialog;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private AlertDialog exitDialog;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() {
                if (bridge == null || bridge.getWebView() == null) return;
                WebView web = bridge.getWebView();
                String url = web.getUrl();
                String path = url == null ? "/" : Uri.parse(url).getPath();
                boolean atHome = path == null || path.equals("/") || path.equals("/hr")
                    || path.equals("/me") || path.equals("/login");
                if (!atHome) {
                    if (web.canGoBack()) web.goBack();
                    else {
                        String home = path.startsWith("/hr/") ? "/hr" : "/me";
                        web.evaluateJavascript("window.location.assign('" + home + "')", null);
                    }
                    return;
                }
                if (exitDialog != null && exitDialog.isShowing()) return;
                exitDialog = new AlertDialog.Builder(MainActivity.this)
                    .setTitle("ออกจากแอพ HR?")
                    .setMessage("ต้องการปิดแอพหรืออยู่หน้าหลักต่อ?")
                    .setNegativeButton("อยู่ต่อ", (dialog, which) -> dialog.dismiss())
                    .setPositiveButton("ออกจากแอพ", (dialog, which) -> finish())
                    .create();
                exitDialog.show();
            }
        });
    }
}
