package __PACKAGE__;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;

public class ElioMessagingService extends FirebaseMessagingService {
    @Override
    public void onMessageReceived(RemoteMessage message) {
        Map<String, String> d = message.getData();
        if (!"call".equals(d.get("type"))) return;
        // When the app is open, the in-app call screen appears by itself (live Firestore listener).
        if (ElioCallPlugin.isForeground()) return;
        CallNotifier.show(this, d.get("callId"), d.get("taskId"), d.get("title"), d.get("body"));
    }
}
