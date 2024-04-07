/**
 *
 * (c) Copyright VNexsus 2024
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */
(function(window, undefined) {

	var baseurl = document.location.pathname.substring(0, document.location.pathname.lastIndexOf("/")).substring(1) + '/';
	var active = false;
	var model = null;
	var channel = null;
	var stream = null;
	var recognizer = null;
	var audioContext = null;
	var recognizerProcessor = null;
	var analyser = null;
	var lastSentenceEnd = null;
	
	window.Asc.plugin.init = function(text) {
		$(document.body).addClass(window.Asc.plugin.getEditorTheme());
		Vosk.createModel(baseurl + 'vendor/vosk/0.0.8/vosk-model-small-ru-0.22.zip').then(function(m){
			model = m;			
			document.getElementById('mic-control').addEventListener('click', toggle);
			$('#mic-control').removeClass('loading');
			$('.loader-container').addClass('hidden');
			
			channel = new MessageChannel();
			recognizer = new model.KaldiRecognizer(48000);
			model.registerPort(channel.port1);
			model.setLogLevel(-2);
			recognizer.setWords(true);
			toggle();

			recognizer.on("result", (message) => {
				if(message.result.text && message.result.text != '')
					addText(createSentence(message.result.result));
			});
			recognizer.on("partialresult", (message) => {
				//not used yet
			});
			
		})
	};

	function toggle() {
		if(!active)
			start();
		else
			stop();
		active = !active;
	}

	function stop() {
		if(audioContext)
			audioContext.suspend().then(function(){
				$('#mic-control').removeClass('active');
				setVolumeLevel(0);
				$('#message-container').empty();
				$('#message-container').append($('<span>Нажмите чтобы начать</span>'));
			});
	}

	function start(){
		
		if(audioContext && audioContext.state == 'suspended') {
			audioContext.resume().then(function(){
				$('#mic-control').addClass('active');
				$('#message-container').empty();
				$('#message-container').append($('<span>Нажмите чтобы остановить</span>'));
				// reconnect recognition worklet
				const source = audioContext.createMediaStreamSource(stream);
				recognizerProcessor.connect(audioContext.destination);
				source.connect(recognizerProcessor);
				// reconnect level analyzer worklet
				source.connect(analyser).connect(audioContext.destination);
			});
		}
		else {
			
			const mediaStream = navigator.mediaDevices.getUserMedia({
				video: false,
				audio: true
			})
			.then(function(s){
				stream = s;
				$('#mic-control').addClass('active');
				$('#message-container').empty();
				$('#message-container').append($('<span>Нажмите чтобы остановить</span>'));

				// create audio context
				audioContext = new AudioContext();
				
				// set up recognition worklet
				audioContext.audioWorklet.addModule('./vendor/vosk/0.0.8/recognizer-processor.js').then(function(){
					recognizerProcessor = new AudioWorkletNode(audioContext, 'recognizer-processor', { channelCount: 1, numberOfInputs: 1, numberOfOutputs: 1 });
					recognizerProcessor.port.postMessage({action: 'init', recognizerId: recognizer.id}, [ channel.port2 ])
					recognizerProcessor.connect(audioContext.destination);
					const source = audioContext.createMediaStreamSource(stream);
					source.connect(recognizerProcessor);
				});
				
				// set up level analyzer worklet
				audioContext.audioWorklet.addModule('./vendor/vumeter/vumeter_processor.js').then(function(){
					let microphone = audioContext.createMediaStreamSource(stream);
					analyser = new AudioWorkletNode(audioContext, 'vumeter');
					analyser.port.onmessage  = event => {
						let _volume = 0
						if (event.data.volume && audioContext.state == 'running')
							_volume = event.data.volume;
						setVolumeLevel(_volume * 500);
					}
					microphone.connect(analyser).connect(audioContext.destination);
				});
				
			})
			.catch((err) => {
				active = false;
				$('#mic-control').removeClass('active');
				parent.Common.UI.error({title: 'Ошибка', msg: 'Не удалось получить доступ к микрофону. Убедитесь, что приложение запущено с ключом --enable-media-stream'});
			});
		}
	}

	function setVolumeLevel(vol) {
		$('#volume-rect').css('height', (100-vol) + '%');
	}

	function createSentence(arr) {
		var newPara = lastSentenceEnd ? (arr[0].word.start - lastSentenceEnd > 1 ? true : false) : true;
		var result = arr[0].word.charAt(0).toUpperCase() + arr[0].word.slice(1);
		for(var i = 1; i < arr.length; i++){
			if(arr[i].start - arr[i-1].end > .6)
				result += ',';
			result += ' ' + arr[i].word;
		}
		lastSentenceEnd = arr[arr.length-1].word.end;
		return {
				new: newPara,
				text: result + '.'
		};
	}

	function addText(sentence){
		window.Asc.scope.text = sentence.text;
		window.Asc.scope.new = sentence.new;
		window.Asc.plugin.callCommand(function(){
			var doc = Api.GetDocument();
			if(Asc.scope.new) {
				var para = Api.CreateParagraph();
				para.AddText(Asc.scope.text);
				doc.Push(para);
			}
			else {
				var p = doc.GetAllParagraphs();
				var para = p[p.length-1];
				para.AddText(' ' + Asc.scope.text);
			}
		}, false, true);
	}

	// service functions
	
 	window.Asc.plugin.button = function(id) {
		if(audioContext)
			audioContext.close();
		if(model)
			model.terminate();
		this.executeCommand("close", "");
	};

	window.Asc.plugin.onThemeChanged = function(theme){
		window.Asc.plugin.onThemeChangedBase(theme);
		$(document.body).removeClass("theme-dark theme-light").addClass(window.Asc.plugin.getEditorTheme());
	}

	window.Asc.plugin.getEditorTheme = function(){
		if(window.localStorage.getItem("ui-theme-id")){
			var match = window.localStorage.getItem("ui-theme-id").match(/\S+\-(\S+)/);
			if(match.length==2)
				return "theme-" + match[1];
		}
		return "theme-light";
	}
	

})(window, undefined);
