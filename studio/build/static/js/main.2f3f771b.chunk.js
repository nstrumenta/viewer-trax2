(this.webpackJsonpstudio=this.webpackJsonpstudio||[]).push([[0],{52:function(e,n,t){},53:function(e,n,t){},73:function(e,n,t){"use strict";t.r(n);var o=t(0),c=t.n(o),r=t(40),s=t.n(r),i=(t(52),t(12)),a=(t(53),t(43)),l=t(90),d=t(88),u=t(4);var f=function(){var e=Object(o.useState)(),n=Object(i.a)(e,2),t=n[0],c=n[1],r=Object(o.useState)(),s=Object(i.a)(r,2),f=s[0],p=s[1],b=Object(o.useRef)(),j=function(){if(b.current){var e=new Uint8Array([0,5,1,239,212]);console.log("sending kGetModInfo",e),b.current.sendBuffer("trax-in",e)}};return Object(o.useEffect)((function(){var e=new URLSearchParams(window.location.search).get("wsUrl"),n=e||"ws://localhost:8088",o=new a.NstrumentaClient({apiKey:"",projectId:"",wsUrl:n});b.current=o,console.log("connecting to ",n),o.addListener("open",(function(){console.log("nst client open"),o.subscribe("serialport-events",(function(e){if(console.log("serialport-events",e),"open"===e.type)c("open"),j()})),o.subscribe("trax2",(function(e){"open"!==t&&c("open"),console.log("trax2",e);var n=e.data[2];if(2===n){var o=(new TextDecoder).decode(new Uint8Array(e.data.slice(3,-2)));console.log(JSON.stringify(e),o),p(o)}else console.log("unhandled frame ID: ".concat(n),e)}))})),o.init()}),[]),Object(u.jsx)("div",{className:"App",children:Object(u.jsxs)(l.a,{children:[Object(u.jsx)(d.a,{variant:"contained",onClick:j,children:"kGetModInfo"}),f]})})};s.a.render(Object(u.jsx)(c.a.StrictMode,{children:Object(u.jsx)(f,{})}),document.getElementById("root"))}},[[73,1,2]]]);
//# sourceMappingURL=main.2f3f771b.chunk.js.map