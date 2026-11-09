package __PACKAGE__;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

public class CallNotifier {
    public static final String CHANNEL = "elio_calls";
    public static final int NOTIF_ID = 4242;

    static void createChannel(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm.getNotificationChannel(CHANNEL) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL, "Calls from Elio", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("Incoming calls when Elio has an update");
        ch.setSound(
            RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE),
            new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIC)
                .build());
        ch.enableVibration(true);
        ch.setVibrationPattern(new long[] {0, 800, 600, 800, 600});
        ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(ch);
    }

    public static void show(Context c, String callId, String taskId, String title, String body) {
        createChannel(c);
        Intent open = new Intent(c, MainActivity.class)
            .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra("elio_call_id", callId == null ? "" : callId)
            .putExtra("elio_task_id", taskId == null ? "" : taskId);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        PendingIntent full = PendingIntent.getActivity(c, 1, open, flags);
        Intent acceptIntent = new Intent(open).putExtra("elio_call_action", "accept");
        PendingIntent accept = PendingIntent.getActivity(c, 2, acceptIntent, flags);
        Intent declineIntent = new Intent(c, CallActionReceiver.class).setAction("elio.DECLINE");
        PendingIntent decline = PendingIntent.getBroadcast(c, 3, declineIntent, flags);

        NotificationCompat.Builder b = new NotificationCompat.Builder(c, CHANNEL)
            .setSmallIcon(android.R.drawable.sym_action_call)
            .setContentTitle(title == null ? "Elio is calling" : title)
            .setContentText(body == null ? "" : body)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(true)
            .setTimeoutAfter(35000)
            .setFullScreenIntent(full, true)
            .setContentIntent(full)
            .addAction(0, "Decline", decline)
            .addAction(0, "Answer", accept);
        if (Build.VERSION.SDK_INT < 26) {
            Uri ring = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
            b.setSound(ring, AudioManager.STREAM_RING).setVibrate(new long[] {0, 800, 600, 800, 600});
        }
        Notification n = b.build();
        n.flags |= Notification.FLAG_INSISTENT; // keep ringing until answered or timed out
        try {
            NotificationManagerCompat.from(c).notify(NOTIF_ID, n);
        } catch (SecurityException e) {
            // Notification permission not granted yet.
        }
    }
}
