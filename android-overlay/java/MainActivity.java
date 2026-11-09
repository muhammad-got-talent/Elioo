package __PACKAGE__;

import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Must be read before super.onCreate, because the plugin consumes the extras.
        boolean fromCall = getIntent() != null && getIntent().hasExtra("elio_call_id");
        registerPlugin(ElioCallPlugin.class);
        super.onCreate(savedInstanceState);
        lockScreenFlags(fromCall);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        boolean fromCall = intent != null && intent.hasExtra("elio_call_id");
        super.onNewIntent(intent);
        lockScreenFlags(fromCall);
    }

    // Show over the lock screen only while a call is active, never otherwise.
    private void lockScreenFlags(boolean on) {
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(on);
            setTurnScreenOn(on);
        }
    }
}
