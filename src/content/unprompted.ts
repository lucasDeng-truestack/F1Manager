import type { Compound } from '../sim/types';
import type { Pool } from './responses';

/** Driver calls the sim's own events can trigger (player-centric). */
export type UnpromptedTrigger =
  | 'lights_out'
  | 'tyres_gone'
  | 'rain'
  | 'safety_car_out'
  | 'safety_car_in'
  | 'puncture'
  | 'overtake_made'
  | 'overtake_lost'
  | 'final_lap'
  | 'pit_exit'        // player rejoins from the box (pitTimeRemaining > 0 → 0), not the PIT_STOP entry
  | 'finish_win'      // P1
  | 'finish_podium'   // P2 to RADIO_PODIUM_LAST
  | 'finish_points'   // up to RADIO_POINTS_LAST
  | 'finish_back';    // the rest

/** `pit_exit` lines depend on the compound fitted, so it has its own table below. */
export const unprompted: { readonly [T in Exclude<UnpromptedTrigger, 'pit_exit'>]: Pool } = {
  lights_out: ['Here we go!', "Lights out, let's go!", "Let's do this!"],
  tyres_gone: ['Tyres are gone!', 'No grip, the rears are dead!', 'These tyres are ****ed!', "I've got nothing left on these!"],
  rain: ["It's raining, turn 3!", "Rain! It's getting slippery!", 'Spots of rain on the visor!', "It's wet out here, guys!"],
  safety_car_out: ['Safety car? What happened?', 'Safety car, safety car!', 'Yellow flags, SC is out!'],
  safety_car_in: ["Safety car's in, let's go!", 'Green flag, here we go!', 'Restart time. Ready.'],
  puncture: ["Puncture! I've got a puncture!", "Tyre's gone, it's a puncture!", "I'm on the rim!"],
  overtake_made: ['Yes! Got him!', 'Easy. Next one.', "That's how it's done!", 'Sent it up the inside!'],
  overtake_lost: ["He's past, ****!", 'Lost a place, sorry.', 'He just drove past me!', "Couldn't hold him."],
  final_lap: ["Last lap, let's bring it home!", 'Final lap, everything now!', 'One more lap!'],
  finish_win: ['Yes! Yes! We won!', 'Get in there! P1!', 'What a race! Thank you guys!'],
  finish_podium: ['Podium! Great job, guys!', 'Yes! On the podium!', 'Podium, get in!'],
  finish_points: ['Decent points today.', 'Good result, guys. Thanks.', "Solid race. We'll take it."],
  finish_back: ['Not our day.', 'Tough one. Sorry, guys.', 'Well, that was painful.', 'We need to talk strategy.'],
};

export const pitExit: { readonly [C in Compound]: Pool } = {
  S: ["Softs on, let's go!", 'Out on the softs. Feels good.', 'Fresh softs, time to attack.'],
  M: ['Mediums on, all good.', 'Out on the mediums.', 'Mediums feel good.'],
  H: ['Hards on, long run now.', 'Out on the hards. Cold though.', "Hards fitted, let's go."],
  I: ['Inters on, much better.', "Out on inters, grip's back.", "Inters fitted. Let's go!"],
};
