package br.com.matchflix.app;

import android.content.pm.ActivityInfo;
import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.widget.FrameLayout;
import androidx.activity.OnBackPressedCallback;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import com.getcapacitor.BridgeWebViewClient;

/**
 * Substitui a MainActivity gerada por `cap add android` (copiada por scripts/build-apk.sh).
 *
 * Corrige o que o Capacitor puro não faz bem para um WebView que abre um site remoto:
 *  - tela cheia de vídeo (o BridgeWebChromeClient padrão cancela onShowCustomView na hora);
 *  - botão Voltar navega no histórico do site (e só fecha o app na primeira página);
 *  - `server.errorPath` só para falhas de rede, não para respostas HTTP 4xx/5xx do site;
 *  - remove a interface JS nativa "androidBridge", que o fallback do Capacitor expõe a
 *    qualquer origem/iframe e que o site remoto não usa.
 */
public class MainActivity extends BridgeActivity {

  private View customView;
  private WebChromeClient.CustomViewCallback customViewCallback;
  private BridgeWebChromeClient chromeClient;

  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);

    final WebView webView = getBridge().getWebView();
    webView.removeJavascriptInterface("androidBridge");

    getBridge()
      .setWebViewClient(
        new BridgeWebViewClient(getBridge()) {
          @Override
          public void onReceivedHttpError(
            WebView view,
            WebResourceRequest request,
            WebResourceResponse errorResponse
          ) {
            // Mantém a página 404/500 do próprio servidor em vez da tela de "sem conexão".
          }
        }
      );

    chromeClient =
      new BridgeWebChromeClient(getBridge()) {
        @Override
        public void onShowCustomView(View view, WebChromeClient.CustomViewCallback callback) {
          showCustomView(view, callback);
        }

        @Override
        public void onHideCustomView() {
          hideCustomView();
        }
      };
    webView.setWebChromeClient(chromeClient);

    getOnBackPressedDispatcher()
      .addCallback(
        this,
        new OnBackPressedCallback(true) {
          @Override
          public void handleOnBackPressed() {
            if (customView != null) {
              hideCustomView();
            } else if (getBridge().getWebView().canGoBack()) {
              getBridge().getWebView().goBack();
            } else {
              finish();
            }
          }
        }
      );
  }

  private void showCustomView(View view, WebChromeClient.CustomViewCallback callback) {
    if (customView != null) {
      callback.onCustomViewHidden();
      return;
    }
    customView = view;
    customViewCallback = callback;

    view.setBackgroundColor(Color.BLACK);
    ((FrameLayout) getWindow().getDecorView()).addView(
        view,
        new FrameLayout.LayoutParams(
          ViewGroup.LayoutParams.MATCH_PARENT,
          ViewGroup.LayoutParams.MATCH_PARENT
        )
      );
    getBridge().getWebView().setVisibility(View.INVISIBLE);
    setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
    setSystemBarsHidden(true);
  }

  private void hideCustomView() {
    if (customView == null) {
      return;
    }
    ((FrameLayout) getWindow().getDecorView()).removeView(customView);
    customView = null;
    getBridge().getWebView().setVisibility(View.VISIBLE);
    setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
    setSystemBarsHidden(false);

    if (customViewCallback != null) {
      customViewCallback.onCustomViewHidden();
      customViewCallback = null;
    }
  }

  private void setSystemBarsHidden(boolean hidden) {
    WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(
      getWindow(),
      getWindow().getDecorView()
    );
    if (hidden) {
      controller.setSystemBarsBehavior(
        WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
      );
      controller.hide(WindowInsetsCompat.Type.systemBars());
    } else {
      controller.show(WindowInsetsCompat.Type.systemBars());
    }
  }
}
