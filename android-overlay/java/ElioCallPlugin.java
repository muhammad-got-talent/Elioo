package __PACKAGE__;

import android.Manifest;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.google.firebase.messaging.FirebaseMessaging;

@CapacitorPlugin(
    name = "ElioCall",
    permissions = { @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "notifications") }
)
public class ElioCallPlugin extends Plugin {
    private static boolean foreground = false;

    public static boolean isForeground() {
        return foreground;
    }

    @Override
    public void load() {
        handleIntent(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        handleIntent(intent);
    }

    @Override
    protected void handleOnResume() {
        foreground = true;
    }

    @Override
    protected void handleOnPause() {
        foreground = false;
    }

    @Override
    protected void handleOnDestroy() {
        foreground = false;
    }

    private void handleIntent(Intent intent) {
        if (intent == null || !intent.hasExtra("elio_call_id")) return;
        NotificationManagerCompat.from(getContext()).cancel(CallNotifier.NOTIF_ID);
        JSObject o = new JSObject();
        o.put("callId", intent.getStringExtra("elio_call_id"));
        o.put("taskId", intent.getStringExtra("elio_task_id"));
        o.put("action", intent.getStringExtra("elio_call_action"));
        notifyListeners("callReceived", o, true);
        intent.removeExtra("elio_call_id");
        intent.removeExtra("elio_call_action");
    }

    @PluginMethod
    public void getToken(final PluginCall call) {
        try {
            FirebaseMessaging.getInstance().getToken().addOnCompleteListener(t -> {
                if (t.isSuccessful() && t.getResult() != null) {
                    JSObject o = new JSObject();
                    o.put("token", t.getResult());
                    call.resolve(o);
                } else {
                    call.reject("Could not get a push token. Was google-services.json included in the build?");
                }
            });
        } catch (Exception e) {
            call.reject("Firebase is not set up in this build (google-services.json is missing).");
        }
    }

    @PluginMethod
    public void canUseFullScreenIntent(PluginCall call) {
        boolean ok = true;
        if (Build.VERSION.SDK_INT >= 34) {
            NotificationManager nm = (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
            ok = nm.canUseFullScreenIntent();
        }
        JSObject o = new JSObject();
        o.put("allowed", ok);
        call.resolve(o);
    }

    @PluginMethod
    public void openFullScreenSettings(PluginCall call) {
        String pkg = getContext().getPackageName();
        Intent i;
        if (Build.VERSION.SDK_INT >= 34) {
            i = new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:" + pkg));
        } else {
            i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, pkg);
        }
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }

    @PluginMethod
    public void simulateCall(final PluginCall call) {
        int delay = call.getInt("delayMs", 8000);
        new Handler(Looper.getMainLooper()).postDelayed(
            () -> CallNotifier.show(getContext(), "test", "", "Elio is calling", "This is a test call."),
            delay);
        call.resolve();
    }

    @PluginMethod
    public void endCall(final PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (Build.VERSION.SDK_INT >= 27) {
                getActivity().setShowWhenLocked(false);
                getActivity().setTurnScreenOn(false);
            }
            call.resolve();
        });
    }
}
