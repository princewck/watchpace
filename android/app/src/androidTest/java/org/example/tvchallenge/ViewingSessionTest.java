package org.example.tvchallenge;

import static org.junit.Assert.*;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.json.*;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class ViewingSessionTest {

  private JSONObject base() throws Exception {
    return new JSONObject()
      .put("status", "allow")
      .put("remaining_seconds", 3600)
      .put("session_used_seconds", 50)
      .put("session_last_play_ms", 100000);
  }

  private JSONObject policy() throws Exception {
    return new JSONObject()
      .put("session_limit_seconds", 60)
      .put("session_break_seconds", 300);
  }

  private JSONArray sample(long at) throws Exception {
    return new JSONArray().put(
      new JSONObject().put("at_ms", at).put("seconds", 10)
    );
  }

  @Test
  public void combinesCloudAndPendingJournalWithoutDoubleCounting()
    throws Exception {
    JSONObject state = base();
    ViewingSession.apply(state, policy(), sample(110000), 110000);
    assertEquals(60, state.getInt("session_used_seconds"));
    assertEquals("session_limit", state.getString("lock_reason"));
    assertEquals(300, state.getInt("session_break_remaining_seconds"));
    state = base();
    ViewingSession.apply(state, policy(), sample(100000), 100000);
    assertEquals(50, state.getInt("session_used_seconds"));
  }

  @Test
  public void shortPauseDoesNotResetButFiveMinutesDoes() throws Exception {
    JSONObject state = base();
    ViewingSession.apply(state, policy(), sample(230000), 230000);
    assertEquals("lock", state.getString("status"));
    state = base();
    ViewingSession.apply(state, policy(), sample(410000), 410000);
    assertEquals(10, state.getInt("session_used_seconds"));
    assertEquals("allow", state.getString("status"));
    state = base();
    state.put("session_used_seconds", 60);
    ViewingSession.apply(state, policy(), new JSONArray(), 399999);
    assertEquals(1, state.getInt("session_break_remaining_seconds"));
    state = base();
    state.put("session_used_seconds", 60);
    ViewingSession.apply(state, policy(), new JSONArray(), 400000);
    assertEquals("allow", state.getString("status"));
  }
}
